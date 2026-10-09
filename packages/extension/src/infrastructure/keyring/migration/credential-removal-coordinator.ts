import { commitCredentialBoundStorageV2Pointer } from '@/core/keyring/application'
import { bytesToHex } from '@/lib/bytes'
import { parseKeyDomainId } from '@/core/keyring/domain'
import {
  parseCredentialArtifactRef,
  parseCredentialTransactionId,
  parseStorageV2GenerationId,
  parseStorageV2SourceFingerprint
} from '@/infrastructure/persistence/schema'
import {
  CREDENTIAL_REPOSITORY_SCHEMA_VERSION,
  STORAGE_V2_SCHEMA_VERSION,
  type CredentialRepository,
  type CredentialTransactionJournal,
  type CredentialTransactionPhase,
  type StorageV2Repository,
  type StorageV2Snapshot
} from '@/ports/repositories'
import {
  buildStorageV2RemovalSnapshot,
  snapshotContainsRemovalTarget,
  type StorageV2RemovalTarget
} from './storage-v2-removal-snapshot'

export interface CredentialRemovalCoordinatorOptions {
  readonly credentialRepository: CredentialRepository
  readonly storageRepository: StorageV2Repository
  readonly now?: () => number
}

export interface CredentialRemovalResult {
  readonly status: 'removed' | 'already-removed' | 'storage-v2-inactive'
  readonly generationId?: string
  readonly transactionId?: string
}

const TEXT_ENCODER = new TextEncoder()

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function nextJournal(
  journal: CredentialTransactionJournal,
  phase: CredentialTransactionPhase,
  updatedAt: number
): CredentialTransactionJournal {
  return Object.freeze({
    ...journal,
    phase,
    revision: journal.revision + 1,
    updatedAt: Math.max(journal.updatedAt, updatedAt)
  })
}

function assertAdvanced(status: string, label: string): void {
  if (status !== 'advanced' && status !== 'already-applied') {
    throw new Error(`${label} failed: ${status}`)
  }
}

function targetMatchesJournal(
  target: StorageV2RemovalTarget,
  journal: CredentialTransactionJournal
): boolean {
  return (
    target.kind === 'wallet' &&
    journal.transitions.length === 1 &&
    journal.transitions[0].kind === 'retire' &&
    journal.transitions[0].keyDomainId === target.keyDomainId
  )
}

export class CredentialRemovalCoordinator {
  private readonly credentialRepository: CredentialRepository
  private readonly storageRepository: StorageV2Repository
  private readonly now: () => number
  private queue: Promise<void> = Promise.resolve()

  constructor(options: CredentialRemovalCoordinatorOptions) {
    this.credentialRepository = options.credentialRepository
    this.storageRepository = options.storageRepository
    this.now = options.now ?? Date.now
  }

  removeAccount(keyDomainId: string, accountId: string): Promise<CredentialRemovalResult> {
    return this.enqueue(() => this.run({ kind: 'account', keyDomainId, accountId }))
  }

  removeWallet(keyDomainId: string): Promise<CredentialRemovalResult> {
    return this.enqueue(() => this.run({ kind: 'wallet', keyDomainId }))
  }

  private enqueue(operation: () => Promise<CredentialRemovalResult>) {
    const result = this.queue.catch(() => {}).then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async run(target: StorageV2RemovalTarget): Promise<CredentialRemovalResult> {
    let pointer = await this.storageRepository.getActivePointer()
    if (!pointer) return Object.freeze({ status: 'storage-v2-inactive' })
    let source = await this.storageRepository.getSnapshot(pointer.generationId)
    if (!source) throw new Error('Active Storage V2 generation is missing')
    let pending = await this.credentialRepository.findIncompleteJournal('remove')

    if (pending) {
      if (!targetMatchesJournal(target, pending)) {
        throw new Error('Another credential removal transaction is incomplete')
      }
      let pendingSnapshot = await this.storageRepository.getSnapshot(
        pending.targetMetadataGenerationId
      )
      if (!pendingSnapshot) {
        if (!snapshotContainsRemovalTarget(source, target)) {
          throw new Error('Pending removal Storage V2 generation is missing')
        }
        const fingerprint = await this.removalFingerprint(source, target)
        const expectedGenerationId = parseStorageV2GenerationId(`storage-v2:remove:${fingerprint}`)
        if (expectedGenerationId !== pending.targetMetadataGenerationId) {
          throw new Error('Pending removal target does not match active Storage V2 metadata')
        }
        const timestamp = source.manifest.verifiedAt ?? source.manifest.createdAt
        pendingSnapshot = buildStorageV2RemovalSnapshot(
          source,
          target,
          expectedGenerationId,
          fingerprint,
          timestamp
        )
        await this.storageRepository.stage(pendingSnapshot)
      }
      await this.finishWalletRemoval(pointer.generationId, pendingSnapshot, pending)
      return Object.freeze({
        status: 'removed',
        generationId: pendingSnapshot.manifest.generationId,
        transactionId: pending.transactionId
      })
    }

    if (!snapshotContainsRemovalTarget(source, target)) {
      return Object.freeze({
        status: 'already-removed',
        generationId: source.manifest.generationId
      })
    }
    const fingerprint = await this.removalFingerprint(source, target)
    const generationId = parseStorageV2GenerationId(`storage-v2:remove:${fingerprint}`)
    const timestamp = source.manifest.verifiedAt ?? source.manifest.createdAt
    const targetSnapshot = buildStorageV2RemovalSnapshot(
      source,
      target,
      generationId,
      fingerprint,
      timestamp
    )

    if (target.kind === 'account') {
      await this.storageRepository.stage(targetSnapshot)
      const commitStatus = await commitCredentialBoundStorageV2Pointer(
        this.storageRepository,
        this.credentialRepository,
        {
          schemaVersion: STORAGE_V2_SCHEMA_VERSION,
          generationId,
          sourceFingerprint: fingerprint,
          committedAt: Math.max(timestamp, this.now())
        },
        source.manifest.generationId
      )
      if (commitStatus !== 'committed') {
        throw new Error(`Storage V2 Account removal commit failed: ${commitStatus}`)
      }
      return Object.freeze({ status: 'removed', generationId })
    }

    const keyDomain = source.keyDomains.find(item => item.id === target.keyDomainId)
    if (!keyDomain) throw new Error('Storage V2 Wallet credential binding is missing')
    const credentialSet = await this.credentialRepository.getCredentialSet(keyDomain.credentialRef)
    if (!credentialSet) throw new Error('Storage V2 Wallet CredentialSet is missing')
    const transactionId = parseCredentialTransactionId(`credential:remove:${fingerprint}`)
    const retiredRefs = Object.values(credentialSet.manifest.engines)
      .filter(engine => engine !== undefined)
      .map(engine => parseCredentialArtifactRef(engine.credentialRef))
    const journal: CredentialTransactionJournal = Object.freeze({
      schemaVersion: CREDENTIAL_REPOSITORY_SCHEMA_VERSION,
      transactionId,
      operation: 'remove',
      targetMetadataGenerationId: generationId,
      transitions: Object.freeze([
        Object.freeze({
          kind: 'retire',
          keyDomainId: parseKeyDomainId(target.keyDomainId),
          sourceCredentialGenerationId: credentialSet.manifest.credentialGenerationId,
          retiredRefs: Object.freeze([
            ...retiredRefs,
            parseCredentialArtifactRef(`retained-v1:${target.keyDomainId}`)
          ])
        })
      ]),
      phase: 'staging',
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    const created = await this.credentialRepository.createJournal(journal)
    if (created !== 'created' && created !== 'already-exists') {
      throw new Error(`Credential removal journal failed: ${created}`)
    }
    await this.storageRepository.stage(targetSnapshot)
    await this.finishWalletRemoval(source.manifest.generationId, targetSnapshot, journal)
    return Object.freeze({ status: 'removed', generationId, transactionId })
  }

  private async removalFingerprint(source: StorageV2Snapshot, target: StorageV2RemovalTarget) {
    return parseStorageV2SourceFingerprint(
      await sha256(
        JSON.stringify({
          schema: 'storage-v2-removal-v1',
          sourceGenerationId: source.manifest.generationId,
          target
        })
      )
    )
  }

  private async finishWalletRemoval(
    sourceGenerationId: StorageV2Snapshot['manifest']['generationId'],
    targetSnapshot: StorageV2Snapshot,
    journalValue: CredentialTransactionJournal
  ): Promise<void> {
    let journal = journalValue
    if (journal.phase === 'staging') {
      const verified = nextJournal(journal, 'verified', this.now())
      assertAdvanced(
        await this.credentialRepository.advanceJournal(verified, journal.revision),
        'Credential removal verification'
      )
      journal = verified
    }
    if (journal.phase === 'verified') {
      const committing = nextJournal(journal, 'committing', this.now())
      assertAdvanced(
        await this.credentialRepository.advanceJournal(committing, journal.revision),
        'Credential removal commit preparation'
      )
      journal = committing
    }
    if (journal.phase === 'committing') {
      const active = await this.storageRepository.getActivePointer()
      if (!active) throw new Error('Storage V2 active pointer disappeared')
      if (active.generationId !== targetSnapshot.manifest.generationId) {
        if (active.generationId !== sourceGenerationId) {
          throw new Error('Storage V2 active generation changed during Wallet removal')
        }
        const commitStatus = await commitCredentialBoundStorageV2Pointer(
          this.storageRepository,
          this.credentialRepository,
          {
            schemaVersion: STORAGE_V2_SCHEMA_VERSION,
            generationId: targetSnapshot.manifest.generationId,
            sourceFingerprint: targetSnapshot.manifest.sourceFingerprint,
            committedAt: Math.max(targetSnapshot.manifest.verifiedAt ?? 0, this.now())
          },
          sourceGenerationId,
          journal.transactionId
        )
        if (commitStatus !== 'committed') {
          throw new Error(`Credential-bound Wallet removal failed: ${commitStatus}`)
        }
      }
      const committed = nextJournal(journal, 'committed-pending-cleanup', this.now())
      assertAdvanced(
        await this.credentialRepository.advanceJournal(committed, journal.revision),
        'Credential removal commit finalization'
      )
      journal = committed
    }
    if (journal.phase === 'committed-pending-cleanup') {
      const transition = journal.transitions[0]
      if (transition.kind !== 'retire') throw new Error('Invalid Wallet removal transition')
      const sourceSet = await this.credentialRepository.getCredentialSetByGeneration(
        transition.sourceCredentialGenerationId
      )
      if (!sourceSet) throw new Error('Removed Wallet CredentialSet is missing')
      const retirementStatus = await this.credentialRepository.retire({
        schemaVersion: CREDENTIAL_REPOSITORY_SCHEMA_VERSION,
        credentialSetRef: sourceSet.credentialSetRef,
        credentialGenerationId: sourceSet.manifest.credentialGenerationId,
        keyDomainId: sourceSet.manifest.keyDomainId,
        reason: 'removed',
        transactionId: journal.transactionId,
        retiredAt: Math.max(journal.updatedAt, this.now())
      })
      if (retirementStatus !== 'created' && retirementStatus !== 'already-exists') {
        throw new Error(`Credential removal retirement failed: ${retirementStatus}`)
      }
      const purgeStatus = await this.credentialRepository.purgeRetiredEnvelopes(
        sourceSet.credentialSetRef,
        journal.transactionId
      )
      if (purgeStatus !== 'purged' && purgeStatus !== 'already-purged') {
        throw new Error(`Removed credential cleanup failed: ${purgeStatus}`)
      }
      const complete = nextJournal(journal, 'complete', this.now())
      assertAdvanced(
        await this.credentialRepository.advanceJournal(complete, journal.revision),
        'Credential removal completion'
      )
    }
  }
}
