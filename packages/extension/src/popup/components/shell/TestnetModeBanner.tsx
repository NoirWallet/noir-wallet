import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { useTranslation } from '@/popup/i18n'
import { shellMessages } from '@/popup/i18n/shell-messages'

export function TestnetModeBanner() {
  const { t } = useTranslation(shellMessages)
  if (DEFAULT_NETWORK !== 'testnet') return null
  return (
    <div className="shrink-0 bg-warning-surface py-1 text-center text-xs font-semibold text-warning">
      {t('testnet')}
    </div>
  )
}
