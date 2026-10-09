import { getBitcoinNetworkConfig } from '@/config/networks'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import type { BitcoinSupportedAddressType } from '@/core/chains/bitcoin'
import {
  bitcoinDiscoveryAddressTypeComplete,
  IndexedDbBitcoinDiscoveryRepository,
  IndexedDbBitcoinInputReservationRepository,
  isActiveBitcoinAddressObservation,
  loadActiveBitcoinDiscoveryContext,
  parseBitcoinAddressType,
  type BitcoinInputReservationRepository,
  type BitcoinDiscoveryState
} from '@/infrastructure/chains/bitcoin'
import { IndexedDbStorageV2Repository } from '@/infrastructure/persistence/repositories'
import {
  DEFAULT_BITCOIN_ADDRESS_TYPE,
  getBitcoinAccountPreferences,
  type BitcoinAccountPreferencesRepository
} from './bitcoin-account-preferences'
import { scanBackgroundBitcoinAddressType } from './bitcoin-transfer'

export interface BitcoinDerivedAddressBalance {
  readonly value: string
  readonly addressType: BitcoinSupportedAddressType
  readonly addressScheme:
    | 'bitcoin-p2pkh'
    | 'bitcoin-p2sh-p2wpkh'
    | 'bitcoin-p2wpkh'
    | 'bitcoin-p2tr'
  readonly change: boolean
  readonly addressIndex: number
  readonly derivationPath: string
  readonly used: boolean
  readonly confirmedRaw: string
  readonly availableRaw: string
  readonly pendingRaw: string
  readonly utxoCount: number
}

export interface BitcoinAddressBalanceCatalog {
  readonly walletId: string
  readonly accountId: string
  readonly accountIndex: number
  readonly chainId: string
  readonly updatedAt: number
  readonly activeAddressType: BitcoinSupportedAddressType
  readonly confirmedRaw: string
  readonly availableRaw: string
  readonly pendingRaw: string
  readonly addresses: readonly BitcoinDerivedAddressBalance[]
}

function outpointKey(transactionId: string, outputIndex: number): string {
  return `${transactionId}:${outputIndex}`
}

function observationTotals(
  observation: BitcoinDiscoveryState['observations'][number],
  unavailableOutpoints: ReadonlySet<string>
) {
  let confirmed = 0n
  let available = 0n
  let pending = 0n
  for (const utxo of observation.utxos) {
    const value = BigInt(utxo.valueRaw)
    if (utxo.status.confirmed) {
      confirmed += value
      if (!unavailableOutpoints.has(outpointKey(utxo.transactionId, utxo.outputIndex))) {
        available += value
      }
    } else pending += value
  }
  return { confirmed, available, pending }
}

export function projectBitcoinAddressBalanceCatalog(
  state: BitcoinDiscoveryState,
  unavailableOutpoints: ReadonlySet<string> = new Set(),
  activeAddressType: BitcoinSupportedAddressType = DEFAULT_BITCOIN_ADDRESS_TYPE
): BitcoinAddressBalanceCatalog {
  let confirmed = 0n
  let available = 0n
  let pending = 0n
  const entries = state.observations
    .filter(observation => isActiveBitcoinAddressObservation(observation, activeAddressType))
    .map(observation => {
      const totals = observationTotals(observation, unavailableOutpoints)
      confirmed += totals.confirmed
      available += totals.available
      pending += totals.pending
      return { observation, totals }
    })
    .map(({ observation, totals }) =>
      Object.freeze({
        value: observation.derived.address,
        addressType: observation.derived.addressType,
        addressScheme: observation.derived.addressScheme,
        change: observation.derived.change,
        addressIndex: observation.derived.addressIndex,
        derivationPath: observation.derived.derivationPath,
        used: observation.activity.used,
        confirmedRaw: totals.confirmed.toString(),
        availableRaw: totals.available.toString(),
        pendingRaw: totals.pending.toString(),
        utxoCount: observation.utxos.length
      })
    )

  return Object.freeze({
    walletId: state.chainAccount.scope.keyDomainId,
    accountId: state.chainAccount.scope.accountId,
    accountIndex: state.accountIndex,
    chainId: state.chainAccount.scope.chainId,
    updatedAt: state.updatedAt,
    activeAddressType,
    confirmedRaw: confirmed.toString(),
    availableRaw: available.toString(),
    pendingRaw: pending.toString(),
    addresses: Object.freeze(entries)
  })
}

export class BitcoinAddressBalancesCoordinator {
  constructor(
    private readonly storageRepository = new IndexedDbStorageV2Repository(),
    private readonly discoveryRepository = new IndexedDbBitcoinDiscoveryRepository(),
    private readonly inputReservations: Pick<
      BitcoinInputReservationRepository,
      'list'
    > = new IndexedDbBitcoinInputReservationRepository(),
    private readonly chainId = getBitcoinNetworkConfig(DEFAULT_NETWORK).chainId,
    private readonly preferences: Pick<
      BitcoinAccountPreferencesRepository,
      'get' | 'set'
    > = getBitcoinAccountPreferences(),
    private readonly scanAddressType: (
      addressType: BitcoinSupportedAddressType
    ) => Promise<BitcoinDiscoveryState | null> = scanBackgroundBitcoinAddressType
  ) {}

  async readActive(): Promise<BitcoinAddressBalanceCatalog | null> {
    const context = await loadActiveBitcoinDiscoveryContext(this.storageRepository, this.chainId)
    if (!context) return null
    const state = await this.discoveryRepository.get({
      chainAccount: context.chainAccount,
      accountIndex: context.accountIndex
    })
    if (!state) return null
    const activeAddressType = await this.preferences.get({
      network: DEFAULT_NETWORK,
      keyDomainId: context.chainAccount.scope.keyDomainId,
      accountId: context.chainAccount.scope.accountId
    })
    const unavailableOutpoints = new Set<string>()
    const reservations = await this.inputReservations.list({
      chainAccount: context.chainAccount,
      accountIndex: context.accountIndex,
      addressType: activeAddressType
    })
    for (const reservation of reservations) {
      for (const outpoint of reservation.outpoints) {
        unavailableOutpoints.add(outpointKey(outpoint.transactionId, outpoint.outputIndex))
      }
    }
    return projectBitcoinAddressBalanceCatalog(state, unavailableOutpoints, activeAddressType)
  }

  async setActive(input: {
    readonly walletId: string
    readonly accountId: string
    readonly addressType: unknown
  }): Promise<BitcoinAddressBalanceCatalog | null> {
    const context = await loadActiveBitcoinDiscoveryContext(this.storageRepository, this.chainId)
    if (
      !context ||
      context.chainAccount.scope.keyDomainId !== input.walletId ||
      context.chainAccount.scope.accountId !== input.accountId
    ) {
      throw new Error('Bitcoin account preference does not match the active Account')
    }
    const addressType = parseBitcoinAddressType(input.addressType)
    if (context.keyDomainSource.kind === 'hardware' && addressType !== 'p2wpkh') {
      throw new Error('Keystone Bitcoin accounts support only Native SegWit')
    }
    const state = await this.scanAddressType(addressType)
    if (
      !state ||
      state.chainAccount.id !== context.chainAccount.id ||
      !bitcoinDiscoveryAddressTypeComplete(state, addressType)
    ) {
      throw new Error('Bitcoin account discovery did not complete')
    }
    await this.preferences.set(
      {
        network: DEFAULT_NETWORK,
        keyDomainId: context.chainAccount.scope.keyDomainId,
        accountId: context.chainAccount.scope.accountId
      },
      addressType
    )
    return this.readActive()
  }
}

export function createBackgroundBitcoinAddressBalancesCoordinator() {
  return new BitcoinAddressBalancesCoordinator()
}
