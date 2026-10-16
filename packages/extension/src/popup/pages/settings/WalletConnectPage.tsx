import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '@iconify/react'
import { DEFAULT_NETWORK } from '@/config/networks'
import type { WalletConnectState } from '@/core/walletconnect/types'
import { launchHardwareSignSurface } from '@/lib/hardware-sign-launcher'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { QRScanner } from '../../components/hardware/QRScanner'
import { useLocation, useNavigate } from '../../provider/Router'

type ActionResponse = { success: true } | { success: false; error: string }
type StateResponse =
  | { success: true; state: WalletConnectState }
  | { success: false; error: string }

function responseError(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    if (typeof response.error === 'string') return response.error
  }
  return 'WalletConnect is unavailable. Try again.'
}

function requestError(error: unknown): string {
  return error instanceof Error ? error.message : 'WalletConnect is unavailable. Try again.'
}

export function WalletConnectPage() {
  const { navigate } = useNavigate()
  const location = useLocation()
  const isFullTab = new URLSearchParams(location.search).get('tab') === '1'
  const [scanning, setScanning] = useState(
    DEFAULT_NETWORK === 'mainnet' &&
      isFullTab &&
      new URLSearchParams(location.search).get('scan') === '1'
  )
  const [scannerKey, setScannerKey] = useState(0)
  const [uri, setUri] = useState('')
  const [state, setState] = useState<WalletConnectState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(true)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'WALLETCONNECT_GET_STATE'
      })) as StateResponse
      if (!activeRef.current || request !== requestRef.current) return
      if (
        !response?.success ||
        !response.state ||
        !Array.isArray(response.state.sessions) ||
        !Array.isArray(response.state.proposals)
      ) {
        throw new Error(responseError(response))
      }
      setState(response.state)
      setError(null)
    } catch (cause) {
      if (activeRef.current && request === requestRef.current) setError(requestError(cause))
    } finally {
      if (activeRef.current && request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    const onMessage = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message) {
        if (message.type === 'WALLETCONNECT_UPDATED') void refresh()
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    void refresh()
    return () => {
      activeRef.current = false
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [refresh])

  const perform = async (key: string, message: Record<string, unknown>) => {
    if (busy) return false
    setBusy(key)
    setError(null)
    try {
      const response = (await chrome.runtime.sendMessage(message)) as ActionResponse
      if (!response?.success) throw new Error(responseError(response))
      await refresh()
      return true
    } catch (cause) {
      if (activeRef.current) setError(requestError(cause))
      return false
    } finally {
      if (activeRef.current) setBusy(null)
    }
  }

  const pair = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed.startsWith('wc:')) {
      setError('Enter a WalletConnect link.')
      return
    }
    const paired = await perform('pair', { type: 'WALLETCONNECT_PAIR', uri: trimmed })
    if (paired && activeRef.current) setUri('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setScanning(false)
    void pair(uri)
  }

  const handleScan = () => {
    setError(null)
    if (isFullTab) {
      setScannerKey(key => key + 1)
      setScanning(true)
      return
    }
    launchHardwareSignSurface(
      chrome.runtime.getURL('index.html#/walletconnect?tab=1&scan=1')
    ).catch(cause => setError(requestError(cause)))
  }

  const handleScannedText = (text: string) => {
    setScanning(false)
    void pair(text)
  }

  const handleBack = () => {
    if (!isFullTab) {
      navigate('/settings')
      return
    }
    chrome.tabs
      .getCurrent()
      .then(tab => (tab?.id === undefined ? undefined : chrome.tabs.remove(tab.id)))
      .catch(cause => setError(requestError(cause)))
  }

  const enabled = DEFAULT_NETWORK === 'mainnet' && state?.enabled !== false

  return (
    <div className={`page-container${isFullTab ? ' page-container--tab' : ''}`}>
      <PageHeader title="WalletConnect" showBack onBack={handleBack} />

      <div className="page-content min-h-0 space-y-5">
        {DEFAULT_NETWORK === 'testnet' || state?.enabled === false ? (
          <p className="text-sm text-muted">WalletConnect is unavailable in this wallet.</p>
        ) : (
          <>
            {scanning && (
              <section className="space-y-3">
                <QRScanner key={scannerKey} onTextScan={handleScannedText} />
                <Button variant="outline" className="w-full" onClick={() => setScanning(false)}>
                  Cancel scan
                </Button>
              </section>
            )}

            <section className="space-y-3">
              <form onSubmit={handleSubmit} className="space-y-3">
                <Input
                  aria-label="WalletConnect link"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste WalletConnect link"
                  value={uri}
                  onChange={event => setUri(event.target.value)}
                  disabled={!!busy || loading}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={!uri.trim() || !!busy || loading || !enabled}
                    isLoading={busy === 'pair'}
                  >
                    Connect
                  </Button>
                  {!scanning && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleScan}
                      disabled={!!busy || loading || !enabled}
                    >
                      <Icon icon="lucide:scan-line" width={16} height={16} />
                      Scan
                    </Button>
                  )}
                </div>
              </form>
            </section>

            {state && state.proposals.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Connection requests</h2>
                {state.proposals.map(proposal => (
                  <div key={proposal.id} className="rounded-md bg-card p-3 space-y-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words">{proposal.name}</div>
                      <div className="text-xs text-muted break-all">{proposal.url}</div>
                    </div>
                    <div className="text-xs text-muted">
                      {proposal.verification === 'VALID' ? 'Verified' : 'Unverified'}
                      {' / '}
                      {state.accountLabel || 'No account available'}
                    </div>
                    <p className="text-xs text-muted">
                      {[
                        proposal.methods.includes('zcash_getAddress') && 'Read addresses',
                        proposal.methods.includes('zcash_getBalance') && 'Read balance',
                        proposal.methods.includes('zcash_getPublicKey') && 'Read public identity',
                        proposal.methods.includes('zcash_signMessage') && 'Request signatures',
                        proposal.methods.includes('zcash_transfer') && 'Request transactions'
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={!state.accountAvailable || !!busy}
                        isLoading={busy === `approve:${proposal.id}`}
                        onClick={() =>
                          void perform(`approve:${proposal.id}`, {
                            type: 'WALLETCONNECT_APPROVE',
                            proposalId: proposal.id
                          })
                        }
                      >
                        Connect
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={!!busy}
                        isLoading={busy === `reject:${proposal.id}`}
                        onClick={() =>
                          void perform(`reject:${proposal.id}`, {
                            type: 'WALLETCONNECT_REJECT',
                            proposalId: proposal.id
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {state && state.sessions.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Connected apps</h2>
                {state.sessions.map(session => (
                  <div key={session.topic} className="rounded-md bg-card p-3 space-y-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words">{session.name}</div>
                      <div className="text-xs text-muted break-all">{session.url}</div>
                      <div className="text-xs text-muted mt-1">{session.accountLabel}</div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={!!busy}
                      isLoading={busy === `disconnect:${session.topic}`}
                      onClick={() =>
                        void perform(`disconnect:${session.topic}`, {
                          type: 'WALLETCONNECT_DISCONNECT',
                          topic: session.topic
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {loading && <p className="text-sm text-muted">Loading...</p>}
        {error && (
          <p role="alert" className="text-xs text-danger break-words">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
