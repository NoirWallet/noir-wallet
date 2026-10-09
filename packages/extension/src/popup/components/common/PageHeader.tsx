import { Icon } from '@iconify/react'
import { useNavigate } from '../../provider/Router'

interface PageHeaderProps {
  title?: string
  onBack?: () => void
  showBack?: boolean
  backDisabled?: boolean
  rightContent?: React.ReactNode
  action?: {
    icon: React.ReactNode
    onClick: () => void
  }
}

export function PageHeader({
  title = 'Noir Wallet',
  onBack,
  showBack = false,
  backDisabled = false,
  rightContent,
  action
}: PageHeaderProps) {
  const { goBack } = useNavigate()
  const handleBack = onBack || goBack

  return (
    <header className="h-14 flex items-center justify-center shrink-0 relative px-4 border-b border-white/10 bg-background">
      {showBack && (
        <button
          onClick={handleBack}
          disabled={backDisabled}
          aria-label="Back"
          className="absolute left-4 w-[26px] h-[26px] rounded-full bg-content2 flex items-center justify-center hover:bg-content3 transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon icon="lucide:chevron-left" width={18} height={18} />
        </button>
      )}
      <span className="text-base font-medium text-white">{title}</span>

      {(rightContent || action) && (
        <div className="absolute right-4 flex items-center">
          {action && (
            <button
              onClick={action.onClick}
              className="w-[26px] h-[26px] flex items-center justify-center rounded-full hover:bg-content3 transition-colors text-muted-foreground hover:text-foreground"
            >
              {action.icon}
            </button>
          )}
          {rightContent}
        </div>
      )}
    </header>
  )
}
