import { Icon } from '@iconify/react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/popup/components/ui/tooltip'
import { createTranslator, useTranslation } from '@/popup/i18n'
import { shellMessages } from '@/popup/i18n/shell-messages'

export interface ZcashSyncProgressState {
  readonly syncProgress: number
  readonly currentHeight: number
  readonly latestHeight: number
  readonly etaMs: number | null
}

interface ZcashSyncProgressProps extends ZcashSyncProgressState {
  readonly className?: string
  readonly showLabel?: boolean
}

function formatEta(
  ms: number,
  t: ReturnType<typeof createTranslator<typeof shellMessages>>
): string {
  const totalSeconds = Math.ceil(ms / 1000)
  if (totalSeconds < 60) return t('underOneMinute')
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.ceil((totalSeconds % 3600) / 60)
  if (hours > 0) return t('approximateHoursMinutes', { hours, minutes })
  return t('approximateMinutes', { minutes })
}

export function ZcashSyncProgress({
  syncProgress,
  currentHeight,
  latestHeight,
  etaMs,
  className,
  showLabel = false
}: ZcashSyncProgressProps) {
  const { locale, t } = useTranslation(shellMessages)
  const hasProgress = latestHeight > 0 && syncProgress > 0
  const progress = hasProgress ? `${syncProgress}%` : t('syncing')
  const formatHeight = (height: number) => (height > 0 ? height.toLocaleString(locale) : '—')
  const time =
    etaMs != null && etaMs > 0
      ? formatEta(etaMs, t)
      : latestHeight > 0 && currentHeight >= latestHeight
        ? t('syncFinishing')
        : '—'
  const label = !showLabel
    ? progress
    : hasProgress
      ? t('syncPercentage', { progress })
      : t('zcashSyncing')

  return (
    <Tooltip
      content={
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xs font-semibold">{t('zcashSyncing')}</span>
          <span className="font-mono text-[10px] opacity-80">
            {t('syncHeight', {
              current: formatHeight(currentHeight),
              latest: formatHeight(latestHeight)
            })}
          </span>
          <span className="font-mono text-[10px] opacity-80">{t('syncEta', { time })}</span>
        </div>
      }
    >
      <div
        role="status"
        aria-label={t('syncProgress', { progress })}
        className={cn(
          'flex h-5 items-center gap-1 rounded-full bg-primary/10 px-2 font-mono text-[10px] text-primary',
          className
        )}
      >
        <Icon icon="lucide:refresh-cw" width={10} height={10} className="animate-spin" />
        <span>{label}</span>
      </div>
    </Tooltip>
  )
}
