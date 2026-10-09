import dayjs from './dayjs'

export type BirthdayHeightSource = 'stored' | 'wasm' | 'fallback' | 'none'

export function getBirthdayDateFromBlockTimestamp(timestamp: number): dayjs.Dayjs | null {
  const blockTime = dayjs.unix(timestamp).utc()
  if (!blockTime.isValid()) return null
  return blockTime.startOf('day')
}

export function getUtcDayStartTimestamp(date: dayjs.Dayjs): number {
  return Math.floor(Date.UTC(date.year(), date.month(), date.date()) / 1_000)
}

export function formatBirthdayDisplay(height: number, timestamp: number): string {
  const dateLabel = getBirthdayDateFromBlockTimestamp(timestamp)?.format('MMM D, YYYY')
  if (!dateLabel) return `#${height.toLocaleString()}`
  return `${dateLabel} · #${height.toLocaleString()}`
}

export function formatBirthdayResyncHint(
  height: number,
  timestamp: number | null,
  source: BirthdayHeightSource
): string {
  const lowerHint = 'choose an earlier height if needed.'
  if (source === 'fallback') {
    return `Resyncs all accounts from current tip #${height.toLocaleString()}; ${lowerHint}`
  }
  if (timestamp != null && (source === 'stored' || source === 'wasm')) {
    return `Resyncs all accounts from ${formatBirthdayDisplay(height, timestamp)}; ${lowerHint}`
  }
  return `Resyncs all accounts from this height; ${lowerHint}`
}
