import type { IWalletKit, WalletKitTypes } from '@reown/walletkit'
import { DedupPromise, withTimeout } from '@/lib/async-utils'
import type { WalletConnectState } from './types'
import {
  approvedNamespaces,
  dappMetadata,
  parsePairingUri,
  providerRequest,
  WALLETCONNECT_CHAIN,
  WalletConnectError,
  walletConnectResult
} from './protocol'

type Client = Pick<
  IWalletKit,
  | 'on'
  | 'pair'
  | 'approveSession'
  | 'rejectSession'
  | 'updateSession'
  | 'respondSessionRequest'
  | 'disconnectSession'
  | 'getActiveSessions'
  | 'getPendingSessionProposals'
  | 'getPendingSessionRequests'
>
type Proposal = ReturnType<Client['getPendingSessionProposals']>[number]

export interface WalletConnectAccount {
  walletId: string
  accountId: string
  label: string
  addresses: { transparent: string; shielded: string }
}

export interface WalletConnectBinding extends WalletConnectAccount {
  topic: string
  name: string
  url: string
  verification?: 'VALID' | 'UNKNOWN'
}

export interface WalletConnectAuthorization extends WalletConnectBinding {
  isActive: () => boolean
}

interface Dependencies {
  enabled: boolean
  createClient: () => Promise<Client>
  getAccount: () => Promise<WalletConnectAccount | null>
  loadBindings: () => Promise<unknown>
  loadConsumedRequests: () => Promise<unknown>
  hasStoredClient: () => Promise<boolean>
  saveBindings: (bindings: WalletConnectBinding[]) => Promise<void>
  saveConsumedRequests: (keys: string[]) => Promise<void>
  request: (
    authorization: WalletConnectAuthorization,
    request: { method: string; params: unknown[] }
  ) => Promise<unknown>
  updated: () => void
  proposalReceived: () => Promise<void>
  failed: (stage: string) => void
}

function isBinding(value: unknown): value is WalletConnectBinding {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<WalletConnectBinding>
  return (
    ['topic', 'walletId', 'accountId', 'label', 'name', 'url'].every(
      key => typeof item[key as keyof WalletConnectBinding] === 'string'
    ) &&
    !!item.addresses &&
    typeof item.addresses.transparent === 'string' &&
    typeof item.addresses.shielded === 'string'
  )
}

/** Session authorization is separate from injected-provider permissions and dApp metadata. */
export class WalletConnectController {
  private client: Client | null = null
  private clientReady = false
  private readonly initialization = new DedupPromise<Client>()
  private readonly restoration = new DedupPromise<void>()
  private restored = false
  private readonly bindings = new Map<string, WalletConnectBinding>()
  private readonly verifications = new Map<number, 'VALID' | 'UNKNOWN'>()
  private readonly blockedProposals = new Set<number>()
  private readonly requests = new Map<string, { expired: boolean }>()
  private readonly completedRequests = new Set<string>()
  private readonly consumedRequests = new Set<string>()
  private readonly approvals = new Map<number, Promise<void>>()
  private requestQueue: Promise<void> = Promise.resolve()
  private persistence: Promise<void> = Promise.resolve()
  private receiptPersistence: Promise<void> = Promise.resolve()

  constructor(private readonly deps: Dependencies) {}

  private persist(): Promise<void> {
    const snapshot = [...this.bindings.values()]
    const next = this.persistence.catch(() => {}).then(() => this.deps.saveBindings(snapshot))
    this.persistence = next
    return next
  }

  private persistReceipts(): Promise<void> {
    const snapshot = [...this.consumedRequests]
    const next = this.receiptPersistence
      .catch(() => {})
      .then(() => this.deps.saveConsumedRequests(snapshot))
    this.receiptPersistence = next
    return next
  }

  private async revoke(topic: string): Promise<void> {
    this.bindings.delete(topic)
    for (const key of this.consumedRequests)
      if (key.startsWith(`${topic}:`)) this.consumedRequests.delete(key)
    await Promise.all([this.persist(), this.persistReceipts()])
  }

  private async restore(): Promise<void> {
    if (this.restored) return
    await this.restoration.run(async () => {
      if (this.restored) return
      const saved = await this.deps.loadBindings()
      if (Array.isArray(saved)) {
        for (const value of saved) if (isBinding(value)) this.bindings.set(value.topic, value)
      }
      const consumed = await this.deps.loadConsumedRequests()
      if (Array.isArray(consumed)) {
        for (const key of consumed) {
          if (typeof key === 'string' && key.length <= 200) this.consumedRequests.add(key)
        }
      }
      this.restored = true
    })
  }

  async start(): Promise<void> {
    if (!this.deps.enabled) return
    await this.restore()
    if (this.bindings.size || (await this.deps.hasStoredClient())) await this.ensureClient()
  }

  private async ensureClient(): Promise<Client> {
    if (!this.deps.enabled)
      throw new WalletConnectError('WalletConnect is available in the mainnet wallet', 5100)
    await this.restore()
    if (this.clientReady && this.client) return this.client
    return this.initialization.run(async () => {
      const client = await this.deps.createClient()
      this.client = client
      client.on('session_proposal', event => {
        void this.onProposal(event).catch(() => this.deps.failed('proposal'))
      })
      client.on('session_request', event => this.enqueueRequest(event))
      client.on('session_delete', event => {
        void this.revoke(event.topic).catch(() => this.deps.failed('session removal'))
        this.deps.updated()
      })
      client.on('proposal_expire', ({ id }) => {
        this.verifications.delete(id)
        this.deps.updated()
      })
      client.on('session_request_expire', ({ id }) => {
        for (const [key, request] of this.requests)
          if (key.endsWith(`:${id}`)) request.expired = true
      })
      const sessions = client.getActiveSessions()
      for (const topic of this.bindings.keys()) if (!sessions[topic]) this.bindings.delete(topic)
      // A session without our account authorization must never acquire it during recovery.
      for (const topic of Object.keys(sessions)) {
        if (!this.bindings.has(topic)) await this.disconnect(topic)
      }
      await this.persist()
      this.clientReady = true
      for (const pending of client.getPendingSessionRequests()) {
        this.enqueueRequest({
          ...pending,
          verifyContext: { verified: { validation: 'UNKNOWN', verifyUrl: '', origin: '' } }
        })
      }
      this.deps.updated()
      return client
    })
  }

  private validateProposal(proposal: Proposal) {
    if (proposal.expiryTimestamp * 1000 <= Date.now())
      throw new WalletConnectError('This connection request has expired')
    const metadata = dappMetadata(proposal.proposer.metadata)
    approvedNamespaces(proposal, { transparent: 'address', shielded: '' })
    return metadata
  }

  private async onProposal(event: WalletKitTypes.SessionProposal): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      const metadata = this.validateProposal(event.params)
      const verified = event.verifyContext.verified
      if (verified.validation === 'INVALID' || verified.isScam) {
        throw new WalletConnectError('WalletConnect identified this website as unsafe', 5000)
      }
      this.verifications.set(
        event.id,
        verified.validation === 'VALID' && verified.origin === metadata.url ? 'VALID' : 'UNKNOWN'
      )
      this.deps.updated()
      await this.deps.proposalReceived()
    } catch (error) {
      this.blockedProposals.add(event.id)
      await client.rejectSession({
        id: event.id,
        reason: {
          code: 5000,
          message: error instanceof Error ? error.message : 'Unsupported connection request'
        }
      })
      this.deps.updated()
    }
  }

  async state(): Promise<WalletConnectState> {
    await this.start()
    const account = this.deps.enabled ? await this.deps.getAccount() : null
    const sessions = this.client?.getActiveSessions() ?? {}
    const proposals = this.client?.getPendingSessionProposals() ?? {}
    return {
      enabled: this.deps.enabled,
      accountLabel: account?.label ?? null,
      accountAvailable: account !== null,
      sessions: [...this.bindings.values()]
        .filter(binding => !!sessions[binding.topic])
        .map(binding => ({
          topic: binding.topic,
          name: binding.name,
          url: binding.url,
          accountLabel: binding.label
        })),
      proposals: Object.values(proposals).flatMap(proposal => {
        try {
          if (this.blockedProposals.has(proposal.id)) return []
          const metadata = this.validateProposal(proposal)
          const { methods } = approvedNamespaces(proposal, {
            transparent: 'address',
            shielded: ''
          }).bip122
          return [
            {
              id: proposal.id,
              ...metadata,
              methods,
              verification: this.verifications.get(proposal.id) ?? ('UNKNOWN' as const)
            }
          ]
        } catch {
          return []
        }
      })
    }
  }

  async pair(value: unknown): Promise<void> {
    const uri = parsePairingUri(value)
    const account = await this.deps.getAccount()
    if (!account) throw new WalletConnectError('Unlock a software wallet account to connect', 4100)
    const client = await this.ensureClient()
    await client.pair({ uri })
  }

  approve(id: number): Promise<void> {
    const pending = this.approvals.get(id)
    if (pending) return pending
    const approval = Promise.resolve()
      .then(() => this.approveProposal(id))
      .finally(() => this.approvals.delete(id))
    this.approvals.set(id, approval)
    return approval
  }

  private async approveProposal(id: number): Promise<void> {
    const client = await this.ensureClient()
    // WalletKit declares a record, but its engine returns proposal.getAll() as an array.
    const proposal = Object.values(client.getPendingSessionProposals()).find(
      proposal => proposal.id === id
    )
    if (!proposal || this.blockedProposals.has(id))
      throw new WalletConnectError('This connection request is no longer available')
    const metadata = this.validateProposal(proposal)
    const account = await this.deps.getAccount()
    if (!account) throw new WalletConnectError('Unlock a software wallet account to connect', 4100)
    const session = await client.approveSession({
      id,
      namespaces: approvedNamespaces(proposal, account.addresses)
    })
    const current = await this.deps.getAccount()
    if (
      !current ||
      current.walletId !== account.walletId ||
      current.accountId !== account.accountId ||
      JSON.stringify(current.addresses) !== JSON.stringify(account.addresses)
    ) {
      await this.disconnect(session.topic)
      throw new WalletConnectError('Account changed. Connect again.', 4100)
    }
    this.bindings.set(session.topic, {
      ...account,
      ...metadata,
      topic: session.topic,
      verification: this.verifications.get(id) ?? 'UNKNOWN'
    })
    try {
      await this.persist()
    } catch (error) {
      await this.disconnect(session.topic)
      throw error
    }
    this.verifications.delete(id)
    this.deps.updated()
  }

  async reject(id: number): Promise<void> {
    if (this.approvals.has(id))
      throw new WalletConnectError('This connection is already being approved')
    const client = await this.ensureClient()
    this.blockedProposals.add(id)
    await client.rejectSession({
      id,
      reason: { code: 5000, message: 'User rejected the connection' }
    })
    this.verifications.delete(id)
    this.deps.updated()
  }

  async disconnect(topic: string): Promise<void> {
    // Revoke first: in-flight approval must fail even if the relay is unavailable.
    await this.revoke(topic)
    this.deps.updated()
    if (this.client?.getActiveSessions()[topic]) {
      try {
        await this.client.disconnectSession({
          topic,
          reason: { code: 6000, message: 'User disconnected the wallet' }
        })
      } catch {
        this.deps.failed('remote disconnect')
      }
    }
  }

  async accountChanged(): Promise<void> {
    await this.restore()
    const account = await this.deps.getAccount()
    for (const binding of [...this.bindings.values()]) {
      if (
        !account ||
        binding.walletId !== account.walletId ||
        binding.accountId !== account.accountId
      ) {
        await this.disconnect(binding.topic)
      } else if (JSON.stringify(binding.addresses) !== JSON.stringify(account.addresses)) {
        const session = this.client?.getActiveSessions()[binding.topic]
        if (!session) continue
        const namespaces = {
          bip122: {
            ...session.namespaces.bip122,
            accounts: [account.addresses.shielded, account.addresses.transparent]
              .filter(Boolean)
              .map(address => `${WALLETCONNECT_CHAIN}:${address}`)
          }
        }
        try {
          const update = await this.client?.updateSession({ topic: binding.topic, namespaces })
          if (!update) throw new WalletConnectError('This session is no longer available')
          await withTimeout(update.acknowledged(), 15_000, 'WalletConnect account update')
          this.bindings.set(binding.topic, { ...binding, addresses: account.addresses })
          await this.persist()
        } catch {
          await this.disconnect(binding.topic)
        }
      }
    }
    this.deps.updated()
  }

  private enqueueRequest(event: WalletKitTypes.SessionRequest): void {
    const key = `${event.topic}:${event.id}`
    if (this.requests.has(key) || this.completedRequests.has(key)) return
    const requestState = { expired: false }
    this.requests.set(key, requestState)
    // Existing approval windows share one surface; queue remote requests to avoid replacing it.
    this.requestQueue = this.requestQueue
      .catch(() => {})
      .then(async () => {
        await this.respond(event, requestState)
      })
      .catch(() => this.deps.failed('request response'))
      .finally(() => {
        this.requests.delete(key)
        this.completedRequests.add(key)
        if (this.completedRequests.size > 1024) {
          const oldest = this.completedRequests.values().next().value
          if (oldest !== undefined) this.completedRequests.delete(oldest)
        }
      })
  }

  private async respond(
    event: WalletKitTypes.SessionRequest,
    state: { expired: boolean }
  ): Promise<void> {
    // The peer can send immediately after settlement, before our binding is saved.
    await Promise.allSettled([...this.approvals.values()])
    const client = this.client
    if (!client) return
    const binding = this.bindings.get(event.topic)
    const isActive = () =>
      !state.expired &&
      this.bindings.get(event.topic) === binding &&
      !!client.getActiveSessions()[event.topic] &&
      (!event.params.request.expiryTimestamp ||
        event.params.request.expiryTimestamp * 1000 > Date.now())
    try {
      const session = client.getActiveSessions()[event.topic]
      if (!binding || !session || !isActive())
        throw new WalletConnectError('This session is no longer authorized', 4100)
      if (event.params.chainId !== WALLETCONNECT_CHAIN)
        throw new WalletConnectError('Unsupported network', 5100)
      const { method, params } = event.params.request
      if (!session.namespaces.bip122?.methods.includes(method))
        throw new WalletConnectError('Method was not authorized for this session', 4100)
      const account = await this.deps.getAccount()
      if (
        !account ||
        account.walletId !== binding.walletId ||
        account.accountId !== binding.accountId
      ) {
        await this.disconnect(event.topic)
        throw new WalletConnectError('Account changed or locked. Connect again.', 4100)
      }
      const request = providerRequest(method, params)
      const key = `${event.topic}:${event.id}`
      if (this.consumedRequests.has(key)) {
        throw new WalletConnectError(
          'This request was already processed or interrupted. Submit a new request.',
          -32000
        )
      }
      if (method === 'zcash_transfer' || method === 'zcash_signMessage') {
        if (this.consumedRequests.size >= 4096)
          throw new WalletConnectError('Reconnect the wallet before submitting more requests', 4100)
        // Persist before side effects: a worker restart must never replay a signature or transfer.
        this.consumedRequests.add(key)
        await this.persistReceipts()
      }
      const result = await this.deps.request({ ...binding, isActive }, request)
      if (state.expired) return
      const current = await this.deps.getAccount()
      if (
        !isActive() ||
        !current ||
        current.walletId !== binding.walletId ||
        current.accountId !== binding.accountId
      ) {
        throw new WalletConnectError('This session is no longer authorized', 4100)
      }
      await client.respondSessionRequest({
        topic: event.topic,
        response: {
          id: event.id,
          jsonrpc: '2.0',
          result: walletConnectResult(method, params, result)
        }
      })
    } catch (error) {
      if (state.expired) return
      // WalletConnect replaces the reserved -32603 message with "Internal error".
      const code =
        error instanceof WalletConnectError
          ? error.code
          : error instanceof Error && /^User rejected/.test(error.message)
            ? 4001
            : -32000
      await client.respondSessionRequest({
        topic: event.topic,
        response: {
          id: event.id,
          jsonrpc: '2.0',
          error: {
            code,
            message: error instanceof Error ? error.message : 'Wallet request failed'
          }
        }
      })
    }
  }
}
