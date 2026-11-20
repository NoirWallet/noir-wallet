import { useCallback, useEffect, useRef, useState } from 'react'
import { getNoirWallet } from '@noir-wallet/sdk'
import {
  NoirShieldSDK,
  ShieldError,
  type ShieldAction,
  type ShieldBalance,
  type ShieldChainInfo,
  type ShieldOperationHandle,
  type ShieldTokenInfo
} from '@noir-wallet/shield-sdk'
import { TokenPicker } from './token-picker'

const sdk = new NoirShieldSDK()
const LAYER = 'near-confidential' as const

type Busy = 'idle' | 'connect' | 'quote' | 'submit' | 'status' | 'wait'
type DestinationKind = 'public' | 'confidential'

function describe(error: unknown): string {
  if (error instanceof ShieldError) {
    const status = error.status ? ` (${error.status})` : ''
    return `${error.code}${status}: ${error.message}`
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'The Shield request failed.'
}

function readWallet(): { installed: boolean; shield: boolean } {
  const installed = getNoirWallet() !== null
  const raw = (window as Window & { noirwallet?: { shield?: { request?: unknown } } }).noirwallet
  return { installed, shield: typeof raw?.shield?.request === 'function' }
}

export default function App() {
  const operationRef = useRef<ShieldOperationHandle | null>(null)
  const waitAbortRef = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState<Busy>('idle')
  const [connected, setConnected] = useState(false)
  const [wallet, setWallet] = useState(readWallet)
  const [action, setAction] = useState<ShieldAction>('receive')
  const [destinationKind, setDestinationKind] = useState<DestinationKind>('public')
  const [chains, setChains] = useState<readonly ShieldChainInfo[]>([])
  const [tokens, setTokens] = useState<readonly ShieldTokenInfo[]>([])
  const [chainId, setChainId] = useState('56')
  const [assetId, setAssetId] = useState('eip155:56/slip44:714')
  const [amount, setAmount] = useState('0.10')
  const [destinationChainId, setDestinationChainId] = useState('1')
  const [destinationAssetId, setDestinationAssetId] = useState('eip155:1/slip44:60')
  const [address, setAddress] = useState('0x1111111111111111111111111111111111111111')
  const [accountId, setAccountId] = useState('0x2222222222222222222222222222222222222222')
  const [operationId, setOperationId] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('30000')
  const [output, setOutput] = useState('Connect a Noir Wallet build that includes Shield requests.')
  const [failed, setFailed] = useState(false)
  const [catalogNote, setCatalogNote] = useState('Connect to load chains and tokens.')
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [balances, setBalances] = useState<readonly ShieldBalance[]>([])
  const [balanceNote, setBalanceNote] = useState('Connect to refresh Shield balances.')
  const [balanceFailed, setBalanceFailed] = useState(false)
  const chainIdRef = useRef(chainId)
  const assetIdRef = useRef(assetId)
  const destinationChainIdRef = useRef(destinationChainId)
  const destinationAssetIdRef = useRef(destinationAssetId)
  chainIdRef.current = chainId
  assetIdRef.current = assetId
  destinationChainIdRef.current = destinationChainId
  destinationAssetIdRef.current = destinationAssetId

  const refreshWallet = useCallback(() => setWallet(readWallet()), [])

  useEffect(() => {
    refreshWallet()
    window.addEventListener('noirwallet#initialized', refreshWallet)
    return () => window.removeEventListener('noirwallet#initialized', refreshWallet)
  }, [refreshWallet])

  useEffect(() => {
    if (!connected) {
      setChains([])
      setTokens([])
      setCatalogFailed(false)
      setCatalogNote('Connect to load chains and tokens.')
      return
    }
    let cancelled = false
    setCatalogFailed(false)
    setCatalogNote('Loading chains and tokens...')
    const query = {
      layer: LAYER,
      action
    } as const
    void (async () => {
      try {
        const [nextChains, nextTokens] = await Promise.all([
          sdk.getSupportedChains(query),
          sdk.getSupportedTokens(query)
        ])
        if (cancelled) return
        setChains(nextChains)
        setTokens(nextTokens)
        const selected = nextTokens.find(
          token => token.chainId === chainIdRef.current && token.assetId === assetIdRef.current
        )
        const pick = selected ?? nextTokens[0]
        if (pick && !selected) {
          setChainId(pick.chainId)
          setAssetId(pick.assetId)
        }
        if (action === 'transfer') {
          const destinationSelected = nextTokens.find(
            token =>
              token.chainId === destinationChainIdRef.current &&
              token.assetId === destinationAssetIdRef.current
          )
          const destinationPick = destinationSelected ?? nextTokens[0]
          if (destinationPick && !destinationSelected) {
            setDestinationChainId(destinationPick.chainId)
            setDestinationAssetId(destinationPick.assetId)
          }
        }
        setCatalogFailed(false)
        setCatalogNote(`${nextChains.length} chains · ${nextTokens.length} tokens`)
      } catch (error) {
        if (cancelled) return
        setChains([])
        setTokens([])
        setCatalogFailed(true)
        setCatalogNote(describe(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connected, action])

  const refreshShieldBalances = useCallback(async () => {
    setBalanceFailed(false)
    setBalanceNote('Refreshing Shield balances...')
    try {
      const next = await sdk.refreshBalances()
      setBalances(next)
      setBalanceNote(next.length === 0 ? 'No Shield balances.' : `${next.length} balances`)
    } catch (error) {
      setBalances([])
      setBalanceFailed(true)
      setBalanceNote(describe(error))
    }
  }, [])

  useEffect(() => {
    if (!connected) {
      setBalances([])
      setBalanceFailed(false)
      setBalanceNote('Connect to refresh Shield balances.')
      return
    }
    void refreshShieldBalances()
  }, [connected, refreshShieldBalances])

  const run = useCallback(async (kind: Busy, task: () => Promise<unknown>) => {
    setBusy(kind)
    setFailed(false)
    try {
      const result = await task()
      setOutput(JSON.stringify(result, null, 2))
    } catch (error) {
      setFailed(true)
      setOutput(describe(error))
    } finally {
      setBusy('idle')
    }
  }, [])

  const remember = (operation: ShieldOperationHandle) => {
    operationRef.current = operation
    setOperationId(operation.id)
    return { id: operation.id, status: operation.status }
  }

  const source = { chainId, assetId }
  const locked = busy !== 'idle'

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>Shield SDK example</h1>
          <p>Local tester for near-confidential receive, transfer, quote, and status.</p>
        </div>
        <p className="status">
          Wallet <strong>{wallet.installed ? 'detected' : 'not installed'}</strong>
          {' · '}
          Shield <strong>{wallet.shield ? 'available' : 'unavailable'}</strong>
          {' · '}
          Session <strong>{connected ? 'connected' : 'not connected'}</strong>
        </p>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Session</h2>
          <p className="hint">Connect opens a session. It does not approve a transfer.</p>
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={locked}
              onClick={() =>
                void run('connect', async () => {
                  const session = await sdk.connect()
                  setConnected(true)
                  return session
                })
              }
            >
              Connect
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={locked}
              onClick={() =>
                void run('connect', async () => {
                  await sdk.disconnect()
                  setConnected(false)
                  return { connected: false }
                })
              }
            >
              Disconnect
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Catalog</h2>
          <p className={catalogFailed ? 'hint error' : 'hint'}>{catalogNote}</p>
          <div className="fields">
            <label>
              Action
              <select
                className="input"
                value={action}
                onChange={event => setAction(event.target.value as ShieldAction)}
              >
                <option value="receive">receive</option>
                <option value="transfer">transfer</option>
              </select>
            </label>
          </div>
          <div className="balances">
            <div className="row">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!connected || locked}
                onClick={() => void refreshShieldBalances()}
              >
                Refresh Shield balances
              </button>
            </div>
            <p className={balanceFailed ? 'hint error' : 'hint'}>{balanceNote}</p>
            {balances.length > 0 ? (
              <ul className="balance-list">
                {balances.map(balance => (
                  <li key={`${balance.chainId}:${balance.assetId}`}>
                    <strong>{balance.symbol}</strong>
                    <span>{balance.chainName || balance.chainId}</span>
                    <span className="balance-amount">{balance.amount}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="card span-2">
          <h2>Request</h2>
          <div className="fields">
            <label>
              Source chain
              <input
                className="input"
                value={chainId}
                onChange={event => setChainId(event.target.value)}
              />
            </label>
            <label>
              Source asset
              <input
                className="input"
                value={assetId}
                onChange={event => setAssetId(event.target.value)}
              />
            </label>
            <label>
              Amount
              <input
                className="input"
                value={amount}
                onChange={event => setAmount(event.target.value)}
              />
            </label>
            {action === 'receive' ? (
              <p className="hint span-2">
                Funds from the selected public-chain asset enter this connected wallet's own Shield
                account.
              </p>
            ) : null}
            <div className="field">
              <span>Loaded token</span>
              <TokenPicker
                tokens={tokens}
                chains={chains}
                chainId={chainId}
                assetId={assetId}
                onSelect={token => {
                  setChainId(token.chainId)
                  setAssetId(token.assetId)
                }}
              />
            </div>
            {action === 'transfer' ? (
              <label>
                Destination kind
                <select
                  className="input"
                  value={destinationKind}
                  onChange={event => setDestinationKind(event.target.value as DestinationKind)}
                >
                  <option value="public">Public chain address</option>
                  <option value="confidential">Confidential account</option>
                </select>
              </label>
            ) : null}
            {action === 'transfer' ? (
              <p className="hint span-2">
                {destinationKind === 'public'
                  ? 'Funds leave Shield and settle to the public-chain address below.'
                  : 'Funds stay on NEAR Confidential and go to another account ID. This wallet rejects the path because the protocol has not confirmed it.'}
              </p>
            ) : null}
            {action === 'transfer' && destinationKind === 'public' ? (
              <>
                <label>
                  Destination chain
                  <input
                    className="input"
                    value={destinationChainId}
                    onChange={event => setDestinationChainId(event.target.value)}
                  />
                </label>
                <label>
                  Destination asset
                  <input
                    className="input"
                    value={destinationAssetId}
                    onChange={event => setDestinationAssetId(event.target.value)}
                  />
                </label>
                <div className="field">
                  <span>Destination token</span>
                  <TokenPicker
                    tokens={tokens}
                    chains={chains}
                    chainId={destinationChainId}
                    assetId={destinationAssetId}
                    onSelect={token => {
                      setDestinationChainId(token.chainId)
                      setDestinationAssetId(token.assetId)
                    }}
                  />
                </div>
                <label>
                  Public address
                  <input
                    className="input"
                    value={address}
                    onChange={event => setAddress(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {action === 'transfer' && destinationKind === 'confidential' ? (
              <label>
                Confidential account ID
                <input
                  className="input"
                  value={accountId}
                  onChange={event => setAccountId(event.target.value)}
                />
              </label>
            ) : null}
          </div>
          {chains.length > 0 ? (
            <p className="hint">Loaded chains: {chains.map(chain => chain.chainId).join(', ')}</p>
          ) : null}
          <div className="row">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={locked}
              onClick={() =>
                void run('quote', () =>
                  sdk.getQuote({
                    layer: LAYER,
                    action,
                    amount,
                    ...(action === 'receive'
                      ? { source }
                      : {
                          token: source,
                          destination:
                            destinationKind === 'public'
                              ? {
                                  kind: 'public',
                                  chainId: destinationChainId,
                                  assetId: destinationAssetId,
                                  address
                                }
                              : { kind: 'confidential', accountId }
                        })
                  })
                )
              }
            >
              Quote
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={locked || action !== 'receive'}
              onClick={() =>
                void run('submit', async () => {
                  const operation = await sdk.shield.receive({ layer: LAYER, source, amount })
                  return remember(operation)
                })
              }
            >
              Receive
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={locked || action !== 'transfer'}
              onClick={() =>
                void run('submit', async () => {
                  const operation = await sdk.shield.transfer({
                    layer: LAYER,
                    token: source,
                    amount,
                    destination:
                      destinationKind === 'public'
                        ? {
                            kind: 'public',
                            chainId: destinationChainId,
                            assetId: destinationAssetId,
                            address
                          }
                        : { kind: 'confidential', accountId }
                  })
                  return remember(operation)
                })
              }
            >
              Transfer
            </button>
          </div>
        </section>

        <section className="card span-2">
          <h2>Operation</h2>
          <p className="hint">
            Refresh reads a stored id after reload. Wait follows the operation created on this page.
            Stopping the wait does not cancel the wallet operation.
          </p>
          <div className="fields">
            <label>
              Operation ID
              <input
                className="input"
                value={operationId}
                onChange={event => setOperationId(event.target.value)}
              />
            </label>
            <label>
              Wait timeout (ms)
              <input
                className="input"
                value={timeoutMs}
                onChange={event => setTimeoutMs(event.target.value)}
              />
            </label>
          </div>
          <div className="row">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={locked || operationId.trim().length === 0}
              onClick={() =>
                void run('status', () =>
                  sdk.getTransactionStatus({ layer: LAYER, operationId: operationId.trim() })
                )
              }
            >
              Refresh status
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={locked || operationRef.current === null}
              onClick={() =>
                void run('wait', async () => {
                  const operation = operationRef.current
                  if (!operation)
                    throw new ShieldError(
                      'INVALID_PARAMS',
                      'Create an operation on this page before waiting.'
                    )
                  const timeout = Number(timeoutMs)
                  if (!Number.isSafeInteger(timeout) || timeout < 0) {
                    throw new ShieldError(
                      'INVALID_PARAMS',
                      'Wait timeout must be a safe integer number of milliseconds.'
                    )
                  }
                  const abort = new AbortController()
                  waitAbortRef.current = abort
                  try {
                    return await operation.wait({ signal: abort.signal, timeoutMs: timeout })
                  } finally {
                    waitAbortRef.current = null
                  }
                })
              }
            >
              Wait
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy !== 'wait'}
              onClick={() => waitAbortRef.current?.abort()}
            >
              Stop wait
            </button>
          </div>
          <pre className={failed ? 'output error' : 'output'}>{output}</pre>
        </section>
      </div>
    </main>
  )
}
