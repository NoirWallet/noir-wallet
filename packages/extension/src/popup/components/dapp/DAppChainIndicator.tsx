import { ChainIcon } from '../common/ChainIcon'

interface DAppChainIndicatorProps {
  connectedDApp?: { name: string; icon: string } | null
  onClick?: () => void
}

export function DAppChainIndicator({ connectedDApp, onClick }: DAppChainIndicatorProps) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-8 h-8 cursor-pointer hover:opacity-80 transition-opacity"
    >
      {connectedDApp ? (
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center relative">
          <img
            src={connectedDApp.icon}
            alt={connectedDApp.name}
            className="w-5 h-5 rounded-full"
            crossOrigin="anonymous"
          />
        </div>
      ) : (
        <div className="w-full h-full rounded-full bg-muted/20 flex items-center justify-center relative">
          <img src="icons/icon128.png" alt="Noir Wallet" className="w-6 h-6 rounded-full" />
        </div>
      )}

      <ChainIcon chain="zcash" className="absolute right-0 bottom-0 w-3 h-3" />
    </button>
  )
}
