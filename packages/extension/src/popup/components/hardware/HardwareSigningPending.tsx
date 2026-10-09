import { Icon } from '@iconify/react'
import { PageHeader } from '@/popup/components/common/PageHeader'

export function HardwareSigningPending({ signerName }: { signerName: string }) {
  return (
    <div className="page-container">
      <PageHeader title="Transaction signing" />
      <div className="page-content flex flex-col items-center justify-center">
        <Icon
          icon="lucide:loader-2"
          width={36}
          height={36}
          className="mb-4 animate-spin text-primary"
        />
        <h2 className="mb-2 text-base font-semibold">Waiting for {signerName}</h2>
        <p className="max-w-[270px] text-center text-sm text-muted">
          Complete the transaction in the {signerName} window.
        </p>
      </div>
    </div>
  )
}
