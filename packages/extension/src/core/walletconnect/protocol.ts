export const WALLETCONNECT_CHAIN = 'bip122:00040fe8ec8471911baa1db1266ea15d'
export const WALLETCONNECT_METHODS = [
  'zcash_getAddress',
  'zcash_getBalance',
  'zcash_transfer',
  'zcash_signMessage',
  'zcash_getPublicKey',
  'zcash_checkLendingMcaAccount',
  'zcash_getMaxTransfer'
] as const
const EVENTS = ['accountsChanged', 'chainChanged']

export class WalletConnectError extends Error {
  constructor(
    message: string,
    readonly code = -32602
  ) {
    super(message)
    this.name = 'WalletConnectError'
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WalletConnectError('Expected an object')
  }
  return value as Record<string, unknown>
}

export function parsePairingUri(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new WalletConnectError('Invalid WalletConnect link')
  }
  const uri = value.trim()
  const match = /^wc:([a-f0-9]{64})@2\?([^#]+)$/i.exec(uri)
  if (!match) throw new WalletConnectError('Enter a WalletConnect v2 link')
  const params = new URLSearchParams(match[2])
  if (
    params.get('relay-protocol') !== 'irn' ||
    !/^[a-f0-9]{64}$/i.test(params.get('symKey') ?? '')
  ) {
    throw new WalletConnectError('Invalid WalletConnect link')
  }
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) throw new WalletConnectError('Invalid WalletConnect link')
  }
  const expiry = params.get('expiryTimestamp')
  if (expiry !== null && (!/^\d+$/.test(expiry) || Number(expiry) * 1000 <= now)) {
    throw new WalletConnectError('This connection link has expired. Create a new one in the app.')
  }
  return uri
}

export function dappMetadata(metadata: { name?: unknown; url?: unknown }): {
  name: string
  url: string
} {
  let url: URL
  try {
    url = new URL(typeof metadata.url === 'string' ? metadata.url : '')
  } catch {
    throw new WalletConnectError('The app did not provide a valid website')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new WalletConnectError('The app must use HTTPS')
  }
  const name =
    typeof metadata.name === 'string'
      ? metadata.name
          .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
          .trim()
          .slice(0, 100)
      : ''
  return { name: name || url.hostname, url: url.origin }
}

function strings(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new WalletConnectError('Invalid session permissions')
  }
  return value
}

export function approvedNamespaces(
  proposal: { requiredNamespaces: unknown; optionalNamespaces?: unknown },
  addresses: { transparent: string; shielded: string }
) {
  const methods = new Set<string>()
  const events = new Set<string>()
  let requestedMainnet = false
  for (const [namespaces, required] of [
    [proposal.requiredNamespaces, true],
    [proposal.optionalNamespaces ?? {}, false]
  ] as const) {
    for (const [name, raw] of Object.entries(record(namespaces))) {
      if (name !== 'bip122' && name !== WALLETCONNECT_CHAIN) {
        if (required) throw new WalletConnectError('The app requested an unsupported network', 5100)
        continue
      }
      const namespace = record(raw)
      const declaredChains = strings(namespace.chains)
      const chains = name === WALLETCONNECT_CHAIN ? [name, ...declaredChains] : declaredChains
      if (
        !chains.includes(WALLETCONNECT_CHAIN) ||
        (required && chains.some(chain => chain !== WALLETCONNECT_CHAIN))
      ) {
        if (required) throw new WalletConnectError('Only Zcash mainnet is supported', 5100)
        continue
      }
      requestedMainnet = true
      for (const method of strings(namespace.methods)) {
        if ((WALLETCONNECT_METHODS as readonly string[]).includes(method)) methods.add(method)
        else if (required) throw new WalletConnectError(`Unsupported method: ${method}`, 4200)
      }
      for (const event of strings(namespace.events)) {
        if (EVENTS.includes(event)) events.add(event)
        else if (required) throw new WalletConnectError(`Unsupported event: ${event}`, 4200)
      }
    }
  }
  if (!requestedMainnet || methods.size === 0) {
    throw new WalletConnectError('The app did not request Zcash mainnet permissions', 5100)
  }
  const accounts = [addresses.shielded, addresses.transparent]
    .filter(Boolean)
    .map(address => `${WALLETCONNECT_CHAIN}:${address}`)
  if (!accounts.length) throw new WalletConnectError('The selected account has no address')
  return {
    bip122: { chains: [WALLETCONNECT_CHAIN], accounts, methods: [...methods], events: [...events] }
  }
}

function only(params: Record<string, unknown>, keys: string[]) {
  if (Object.keys(params).some(key => !keys.includes(key))) {
    throw new WalletConnectError('Unsupported request parameters')
  }
}

function signingMode(params: Record<string, unknown>) {
  const mode = params.signingMode ?? 'current'
  if (mode !== 'current' && mode !== 'derived' && mode !== 'legacy_index0') {
    throw new WalletConnectError('Unsupported signing mode')
  }
  return mode
}

export function providerRequest(
  method: string,
  input: unknown
): { method: string; params: unknown[] } {
  const params = input === undefined ? {} : record(input)
  switch (method) {
    case 'zcash_getAddress':
      only(params, ['type'])
      if (
        params.type !== undefined &&
        params.type !== 'transparent' &&
        params.type !== 'shielded'
      ) {
        throw new WalletConnectError('Unsupported address type')
      }
      return { method: 'zcash_getAddresses', params: [] }
    case 'zcash_getBalance':
    case 'zcash_checkLendingMcaAccount':
      only(params, [])
      return { method, params: [] }
    case 'zcash_getPublicKey':
      only(params, ['signingMode'])
      return { method, params: [{ signingMode: signingMode(params) }] }
    case 'zcash_signMessage':
      only(params, ['message', 'signingMode'])
      if (
        typeof params.message !== 'string' ||
        !params.message.length ||
        params.message.length > 10000
      ) {
        throw new WalletConnectError('Message must contain between 1 and 10000 characters')
      }
      return { method, params: [params.message, { signingMode: signingMode(params) }] }
    case 'zcash_transfer':
      only(params, ['to', 'amount', 'memo', 'fundingSource'])
      return { method: 'zcash_sendTransaction', params: [params] }
    case 'zcash_getMaxTransfer':
      only(params, ['to', 'memo', 'feeTier', 'fundingSource'])
      return { method, params: [params] }
    default:
      throw new WalletConnectError(`Unsupported method: ${method}`, 4200)
  }
}

export function walletConnectResult(method: string, input: unknown, result: unknown): unknown {
  if (method === 'zcash_transfer') return { txid: result }
  if (method === 'zcash_getAddress') {
    const type = record(input ?? {}).type === 'transparent' ? 'transparent' : 'shielded'
    const address = record(result)[type]
    if (typeof address !== 'string' || !address)
      throw new WalletConnectError('The requested address is unavailable')
    return { account: `${WALLETCONNECT_CHAIN}:${address}`, address, type }
  }
  if ((method === 'zcash_getPublicKey' || method === 'zcash_signMessage') && result !== null) {
    const identity = record(result)
    const { pubkey, ...rest } = identity
    return { ...rest, publicKey: pubkey }
  }
  return result
}
