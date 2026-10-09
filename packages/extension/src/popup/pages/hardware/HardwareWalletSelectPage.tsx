import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import ledgerLogo from '@/images/ledger-logo.svg'
import keystoneLogo from '@/images/keystone-logo.webp'

export function HardwareWalletSelectPage() {
  const { navigate } = useNavigate()

  return (
    <div className="page-container page-container--tab">
      <PageHeader title="Connect Hardware Wallet" />
      <div className="page-content">
        <div className="pt-3 mb-7">
          <p className="text-2xl font-bold mb-2">Choose your device</p>
          <p className="text-sm text-muted leading-relaxed">
            Your spending keys stay on the hardware wallet. Noir only imports the account data
            needed to sync and prepare transactions.
          </p>
        </div>

        <div className="space-y-4">
          <HardwareWalletCard
            ariaLabel="Connect Ledger using USB or Bluetooth"
            logo={<img src={ledgerLogo} alt="Ledger" className="h-8 w-auto" />}
            description="Connect directly and approve each transaction on your Ledger."
            capabilities={[
              { icon: 'lucide:usb', label: 'USB' },
              { icon: 'lucide:bluetooth', label: 'Bluetooth' }
            ]}
            onClick={() => navigate('/hardware/ledger/connect')}
          />

          <HardwareWalletCard
            ariaLabel="Connect Keystone using air-gapped QR signing"
            logo={<img src={keystoneLogo} alt="Keystone" className="h-6 w-auto" />}
            description="Scan animated QR codes while your Keystone stays fully air-gapped."
            capabilities={[{ icon: 'lucide:scan-line', label: 'QR signing' }]}
            onClick={() => navigate('/hardware/keystone/connect')}
          />
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
          <Icon icon="lucide:shield-check" width={18} height={18} className="text-primary mt-0.5" />
          <p className="text-xs text-muted leading-relaxed">
            Noir never receives or stores the hardware wallet's spending keys.
          </p>
        </div>
      </div>
    </div>
  )
}

function HardwareWalletCard({
  ariaLabel,
  logo,
  description,
  capabilities,
  onClick
}: {
  ariaLabel: string
  logo: ReactNode
  description: string
  capabilities: Array<{ icon: string; label: string }>
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="group w-full rounded-2xl border border-white/10 bg-card p-5 text-left transition-all hover:border-primary/50 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex min-h-9 items-center justify-between gap-4">
        {logo}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-muted transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <Icon icon="lucide:arrow-up-right" width={17} height={17} />
        </span>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-foreground/90">{description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {capabilities.map(capability => (
          <span
            key={capability.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-muted"
          >
            <Icon icon={capability.icon} width={13} height={13} />
            {capability.label}
          </span>
        ))}
      </div>
    </button>
  )
}
