interface DAppChainIndicatorProps {
  connectedDApp?: { name: string; icon: string } | null
  onClick?: () => void
}

export function DAppChainIndicator({ connectedDApp, onClick }: DAppChainIndicatorProps) {
  return (
    <button
      type="button"
      aria-label="Manage connected dApps"
      onClick={onClick}
      className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-card/60 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
    >
      {connectedDApp ? (
        <img
          src={connectedDApp.icon || 'icons/icon128.png'}
          alt={connectedDApp.name}
          className="size-[18px] rounded-md"
          crossOrigin="anonymous"
          onError={event => {
            event.currentTarget.src = 'icons/icon128.png'
          }}
        />
      ) : (
        <img src="icons/icon128.png" alt="Noir Wallet" className="size-[18px] rounded-md" />
      )}
    </button>
  )
}
