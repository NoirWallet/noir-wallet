import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { useOnboardingTranslation } from './useOnboardingTranslation'

const englishWeekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function OnboardingRecoveryDatePicker({
  value,
  minDate,
  onChange
}: {
  readonly value: dayjs.Dayjs | null
  readonly minDate: dayjs.Dayjs
  readonly onChange: (date: dayjs.Dayjs) => void
}) {
  const { t, locale } = useOnboardingTranslation()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => (value ?? dayjs()).startOf('month'))
  const today = dayjs()
  const maxDate = today.endOf('day')
  const formats = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      selected: new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      full: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' })
    }),
    [locale]
  )

  useEffect(() => {
    if (value) setViewMonth(value.startOf('month'))
  }, [value])

  const gridStart = viewMonth.startOf('month').startOf('week')
  const days = Array.from({ length: 42 }, (_, index) => gridStart.add(index, 'day'))
  const previousMonth = viewMonth.subtract(1, 'month')
  const nextMonth = viewMonth.add(1, 'month')
  const canGoPrevious = previousMonth.endOf('month').isSameOrAfter(minDate, 'day')
  const canGoNext = nextMonth.startOf('month').isSameOrBefore(maxDate, 'day')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('firstTransactionDate')}
          className={cn(
            'flex items-center justify-between w-full h-[46px] px-4 rounded-xl border border-input bg-transparent text-sm transition-colors',
            'hover:border-ring focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
            !value && 'text-muted-foreground/50'
          )}
        >
          <span>{value ? formats.selected.format(value.toDate()) : t('selectDate')}</span>
          <Icon
            icon="lucide:calendar"
            width={16}
            height={16}
            className="text-muted"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[60] w-[280px] p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('previousMonth')}
            title={t('previousMonth')}
            onClick={() => setViewMonth(previousMonth)}
            disabled={!canGoPrevious}
          >
            <Icon icon="lucide:chevron-left" width={16} height={16} aria-hidden="true" />
          </Button>
          <span className="text-sm font-semibold">{formats.month.format(viewMonth.toDate())}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('nextMonth')}
            title={t('nextMonth')}
            onClick={() => setViewMonth(nextMonth)}
            disabled={!canGoNext}
          >
            <Icon icon="lucide:chevron-right" width={16} height={16} aria-hidden="true" />
          </Button>
        </div>
        <div className="mb-1 grid grid-cols-7" aria-hidden="true">
          {days.slice(0, 7).map((date, index) => (
            <span
              key={date.date()}
              className="flex h-7 items-center justify-center text-[11px] text-muted"
            >
              {locale === 'en' ? englishWeekdays[index] : formats.weekday.format(date.toDate())}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {days.map(date => {
            const disabled = date.isBefore(minDate, 'day') || date.isAfter(maxDate, 'day')
            const selected = value?.isSame(date, 'day') ?? false
            const outsideMonth = !date.isSame(viewMonth, 'month')

            return (
              <button
                type="button"
                key={date.format('YYYY-MM-DD')}
                aria-label={formats.full.format(date.toDate())}
                aria-current={date.isSame(today, 'day') ? 'date' : undefined}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  onChange(date.startOf('day'))
                  setOpen(false)
                }}
                className={cn(
                  'h-8 w-8 rounded-md text-xs transition-colors',
                  disabled && 'cursor-not-allowed opacity-25',
                  outsideMonth && !selected && 'text-muted/40',
                  !disabled && !selected && 'cursor-pointer hover:bg-accent',
                  selected && 'bg-primary font-semibold text-primary-foreground'
                )}
              >
                {date.date()}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
