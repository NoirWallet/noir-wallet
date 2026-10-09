import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'

export function HardwareConnectPage() {
  const { navigate } = useNavigate()
  return (
    <div className="page-container page-container--tab">
      <PageHeader title="Connect Hardware Wallet" showBack />
      <div className="page-content space-y-3 pt-6">
        {[
          { name: 'Keystone', route: '/hardware/keystone-connect', icon: 'lucide:scan-line' },
          { name: 'Ledger', route: '/hardware/ledger-connect', icon: 'lucide:usb' }
        ].map(device => (
          <button
            key={device.name}
            type="button"
            onClick={() => navigate(device.route)}
            className="flex w-full items-center gap-4 rounded-md border border-border bg-card px-4 py-5 text-left hover:border-primary"
          >
            <Icon icon={device.icon} width={24} height={24} />
            <span className="flex-1 font-medium">{device.name}</span>
            <Icon icon="lucide:chevron-right" width={18} height={18} />
          </button>
        ))}
      </div>
    </div>
  )
}
