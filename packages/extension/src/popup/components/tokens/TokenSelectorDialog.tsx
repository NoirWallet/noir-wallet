import type { ReactNode } from 'react'
import { useTranslation } from '@/popup/i18n'
import { pickerMessages } from '@/popup/i18n/picker-messages'
import { PageHeader } from '../common/PageHeader'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

export function TokenSelectorContent({
  title,
  onBack,
  children
}: {
  readonly title?: string
  readonly onBack: () => void
  readonly children: ReactNode
}) {
  const { t } = useTranslation(pickerMessages)
  const label = title ?? t('selectToken')
  return (
    <>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      <PageHeader title={label} showBack onBack={onBack} />
      <div className="min-h-0 flex-1 px-4 pb-2">{children}</div>
    </>
  )
}

export function TokenSelectorDialog({
  open,
  onOpenChange,
  title,
  children
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title?: string
  readonly children: ReactNode
}) {
  const { t } = useTranslation(pickerMessages)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="fullscreen"
        scroll="body"
        showCloseButton={false}
        className="gap-0 p-0"
      >
        <DialogDescription className="sr-only">{t('chooseAsset')}</DialogDescription>
        <TokenSelectorContent title={title} onBack={() => onOpenChange(false)}>
          {children}
        </TokenSelectorContent>
      </DialogContent>
    </Dialog>
  )
}
