import type { V1MetadataDiscovery } from '@/infrastructure/persistence/migrations'
import type { CredentialRepository, StorageV2Repository } from '@/ports/repositories'
import { reconcileActiveHardwareCredentials } from './hardware-credential-reconciliation'
import { CredentialRemovalCoordinator } from './credential-removal-coordinator'
import {
  RetainedV1InventoryCoordinator,
  type RetainedV1InventoryResult
} from './retained-v1-inventory-coordinator'
import type {
  CompatibilityInventoryPort,
  RetainedV1InventoryInput
} from './retained-v1-inventory-support'

export interface RetainedV1ReconciliationCoordinatorOptions {
  readonly credentialRepository: CredentialRepository
  readonly storageRepository: StorageV2Repository
  readonly compatibilityWorker?: CompatibilityInventoryPort
  readonly now?: () => number
}

export interface RetainedV1ReconciliationResult {
  readonly status: 'synchronized' | 'already-synchronized'
  readonly generationId: string
  readonly removedKeyDomainIds: readonly string[]
  readonly removedAccountIds: readonly string[]
  readonly inventory: RetainedV1InventoryResult
}

function assertReconciliationDiscovery(
  discovery: V1MetadataDiscovery
): ReadonlyMap<string, ReadonlySet<string>> {
  if (discovery.status !== 'ready' || discovery.wallets.length === 0) {
    throw new Error(`V1 reconciliation metadata is not ready: ${discovery.status}`)
  }
  if (discovery.wallets.some(wallet => wallet.accounts.length === 0)) {
    throw new Error('V1 reconciliation cannot include a Wallet without Accounts')
  }
  if (!discovery.wallets.some(wallet => wallet.keySource === 'software')) {
    throw new Error('V1 reconciliation requires a software Wallet Set')
  }
  return new Map(
    discovery.wallets.map(wallet => [
      wallet.id,
      new Set(wallet.accounts.map(account => account.id))
    ])
  )
}

export function isNativeV2CredentialKeyDomain(keyDomain: {
  readonly id: string
  readonly source: { readonly kind: string }
}): boolean {
  return (
    (keyDomain.source.kind === 'hardware' && isNativeHardwareWalletId(keyDomain.id)) ||
    (keyDomain.source.kind === 'private-key' && keyDomain.id.startsWith('wallet:private-key-v2:'))
  )
}

export class RetainedV1ReconciliationCoordinator {
  private readonly credentialRepository: CredentialRepository
  private readonly storageRepository: StorageV2Repository
  private readonly removal: CredentialRemovalCoordinator
  private readonly inventory: RetainedV1InventoryCoordinator
  private inFlight: Promise<RetainedV1ReconciliationResult> | null = null

  constructor(options: RetainedV1ReconciliationCoordinatorOptions) {
    this.credentialRepository = options.credentialRepository
    this.storageRepository = options.storageRepository
    this.removal = new CredentialRemovalCoordinator(options)
    this.inventory = new RetainedV1InventoryCoordinator(options)
  }

  synchronize(input: RetainedV1InventoryInput): Promise<RetainedV1ReconciliationResult> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.run(input).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(input: RetainedV1InventoryInput): Promise<RetainedV1ReconciliationResult> {
    const desiredAccountsByWallet = assertReconciliationDiscovery(input.discovery)
    let pointer = await this.storageRepository.getActivePointer()
    if (!pointer) throw new Error('Storage V2 is not active')
    let source = await this.storageRepository.getSnapshot(pointer.generationId)
    if (!source) throw new Error('Active Storage V2 generation is missing')
    if (source.keyDomains.some(keyDomain => keyDomain.source.kind === 'hardware')) {
      await reconcileActiveHardwareCredentials(
        this.credentialRepository,
        source,
        input.discovery,
        input.credentialEnvelopes,
        input.password,
        { allowRemovedWallets: true }
      )
    }
    const removedKeyDomainIds: string[] = []
    const removedAccountIds: string[] = []
    const pendingRemoval = await this.credentialRepository.findIncompleteJournal('remove')
    if (pendingRemoval) {
      const transition = pendingRemoval.transitions[0]
      if (pendingRemoval.transitions.length !== 1 || transition.kind !== 'retire') {
        throw new Error('Incomplete removal journal is not a Wallet retirement')
      }
      await this.removal.removeWallet(transition.keyDomainId)
      if (!desiredAccountsByWallet.has(transition.keyDomainId)) {
        removedKeyDomainIds.push(transition.keyDomainId)
      }
      pointer = (await this.storageRepository.getActivePointer()) ?? pointer
      source = (await this.storageRepository.getSnapshot(pointer.generationId)) ?? source
    }

    for (const keyDomain of source.keyDomains) {
      if (desiredAccountsByWallet.has(keyDomain.id) || isNativeV2CredentialKeyDomain(keyDomain)) {
        continue
      }
      await this.removal.removeWallet(keyDomain.id)
      removedKeyDomainIds.push(keyDomain.id)
    }

    pointer = (await this.storageRepository.getActivePointer()) ?? pointer
    source = (await this.storageRepository.getSnapshot(pointer.generationId)) ?? source
    for (const account of source.accounts) {
      const desiredAccounts = desiredAccountsByWallet.get(account.keyDomainId)
      if (!desiredAccounts || desiredAccounts.has(account.id)) continue
      await this.removal.removeAccount(account.keyDomainId, account.id)
      removedAccountIds.push(account.id)
    }

    const inventory = await this.inventory.synchronize(input)
    const changed =
      removedKeyDomainIds.length > 0 ||
      removedAccountIds.length > 0 ||
      inventory.status === 'synchronized'
    return Object.freeze({
      status: changed ? 'synchronized' : 'already-synchronized',
      generationId: inventory.generationId,
      removedKeyDomainIds: Object.freeze(removedKeyDomainIds),
      removedAccountIds: Object.freeze(removedAccountIds),
      inventory
    })
  }
}
import { isNativeHardwareWalletId } from '@/core/wallet/native-hardware-identity'
