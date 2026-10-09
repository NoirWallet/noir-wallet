import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { useDAppConnection } from '@/popup/hooks/useDAppConnection'
import { useState } from 'react'
import { Loading } from '../ui/loading'
import { useWalletStore } from '@/store/wallet-store'
import { getNetworkConfig } from '@/config/networks'

export function DAppConnectionModal() {
  const { connectedDApps, loading, disconnectDApp } = useDAppConnection()
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const network = useWalletStore(state => state.currentNetwork)
  const currentNetwork = getNetworkConfig(network).name

  const handleDisconnect = async (origin: string) => {
    if (disconnecting) return

    setDisconnecting(origin)
    try {
      await disconnectDApp(origin)
    } catch (error) {
      console.error('Failed to disconnect:', error)
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden">
      <div className="mb-6">
        <div className="text-xs text-muted mb-2">Current Network</div>
        <div className="flex items-center gap-2 px-4 py-3 bg-card rounded-xl">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon icon="lucide:link" width={16} height={16} className="text-primary" />
          </div>
          <span className="font-medium">{currentNetwork}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="text-xs text-muted mb-3">Connected dApps</div>
        {loading ? (
          <div className="text-center py-8 text-muted">
            <Loading text="Loading..." />
          </div>
        ) : connectedDApps.length === 0 ? (
          <div className="text-center py-8 text-muted">
            <Icon icon="lucide:unplug" width={32} height={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No connected dApps</p>
          </div>
        ) : (
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {connectedDApps.map(dapp => (
              <div
                key={dapp.id}
                className="flex items-center justify-between px-4 py-3 bg-card rounded-xl"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                  <img
                    src={dapp.favicon}
                    alt={dapp.name}
                    className="w-8 h-8 rounded-full shrink-0"
                    onError={e => {
                      ;(e.target as HTMLImageElement).src =
                        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48ZyBmaWxsPSJub25lIiBzdHJva2U9IiNlNmU2ZTYiIHN0cm9rZS13aWR0aD0iMS41Ij48cGF0aCBkPSJtOS44NTMgMTQuNjMzbC02LjIwMS0zLjk0NmEyIDIgMCAwIDEgMC0zLjM3NGw2LjItMy45NDZhNCA0IDAgMCAxIDQuMjk2IDBsNi4yIDMuOTQ2YTIgMiAwIDAgMSAwIDMuMzc0bC02LjIgMy45NDZhNCA0IDAgMCAxLTQuMjk2IDBaIi8+PHBhdGggZD0ibTE4LjI4NiAxMmwyLjA2MyAxLjMxM2EyIDIgMCAwIDEgMCAzLjM3NGwtNi4yMDEgMy45NDZhNCA0IDAgMCAxLTQuMjk2IDBsLTYuMi0zLjk0NmEyIDIgMCAwIDEgMC0zLjM3NEw1LjcxNCAxMiIvPjwvZz48L3N2Zz4='
                    }}
                  />
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="font-medium text-sm truncate">{dapp.name}</div>
                    <div className="text-xs text-muted truncate">{dapp.host}</div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDisconnect(dapp.origin)}
                  disabled={disconnecting === dapp.origin}
                  className="text-danger hover:text-danger hover:bg-danger/10 flex-shrink-0"
                >
                  {disconnecting === dapp.origin ? (
                    <Icon icon="lucide:loader-2" width={16} height={16} className="animate-spin" />
                  ) : (
                    'Disconnect'
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
