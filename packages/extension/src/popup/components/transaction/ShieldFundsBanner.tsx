import { Icon } from '@iconify/react'
import Big from 'big.js'
import { formatNumber } from '@/lib/format'
import { hasEnoughTransparentBalanceToShield } from '@/core/zcash/shielding'
import { openModal } from '../../provider/ModalManager'
import { Button } from '../ui/button'

function WhyShieldContent() {
  const benefits = [
    {
      icon: 'lucide:lock-keyhole',
      title: 'Full privacy',
      description: 'Shielded transactions hide amounts and participants.'
    },
    {
      icon: 'lucide:scan-eye',
      title: 'Selective disclosure',
      description: 'You choose which transaction details to reveal.'
    },
    {
      icon: 'lucide:shield-check',
      title: 'Enhanced security',
      description: 'Keep your activity protected from blockchain surveillance.'
    }
  ]

  return (
    <div className="space-y-5 px-3 py-4">
      {benefits.map(benefit => (
        <div key={benefit.title} className="flex gap-4">
          <Icon icon={benefit.icon} className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h4 className="mb-1 text-sm font-medium">{benefit.title}</h4>
            <p className="text-sm leading-relaxed text-muted">{benefit.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

interface ShieldFundsBannerProps {
  transparentBalance: string
  isShielding: boolean
  onShield: () => void
}

export function ShieldFundsBanner({
  transparentBalance,
  isShielding,
  onShield
}: ShieldFundsBannerProps) {
  if (!hasEnoughTransparentBalanceToShield(transparentBalance)) return null

  const handleWhyShield = async () => {
    await openModal({
      title: 'Why shielded?',
      showCloseButton: true,
      body: () => <WhyShieldContent />
    })
  }

  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2">
      <Icon icon="lucide:alert-triangle" className="size-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-xs leading-snug text-warning">
        <strong>{formatNumber(transparentBalance, { rm: Big.roundDown })} ZEC</strong> in
        transparent - shield for private spending.
        <button
          type="button"
          onClick={handleWhyShield}
          className="ml-1 underline decoration-dotted underline-offset-2 hover:opacity-80"
        >
          Why?
        </button>
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 border-warning/30 px-2.5 text-xs text-warning hover:border-warning/40 hover:bg-warning/30 hover:text-warning/80"
        onClick={onShield}
        isLoading={isShielding}
      >
        Shield
      </Button>
    </div>
  )
}
