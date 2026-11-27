import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { parseZcashBirthdayHeightInput } from '@/core/wallet/birthday-height'
import { classifyError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useWalletStore } from '@/store/wallet-store'
import { homeActivityPath } from '../../services/home-navigation'
import {
  parseZcashRecoveryTxid,
  rescanZcashRange,
  rescanZcashTransaction,
  resyncZcashWallet,
  supportsZcashRecovery,
  type ZcashTransactionRescanResult
} from '../../services/zcash-settings-client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { InlineError } from '../common/InlineError'
import { TransactionNotice } from '../transaction/TransactionNotice'
import { ResyncZcashContent } from './AccountModals'

const TRANSACTION_STATUS = {
  'already-present': 'Transaction is already in Activity.',
  restored: 'Transaction restored.',
  pending: 'Transaction is pending.',
  'not-found': 'No matching transaction found for this account.',
  unavailable: 'Lookup temporarily unavailable.'
} satisfies Record<ZcashTransactionRescanResult['status'], string>

type ScanMethod = 'transaction' | 'range'
type ScanResult =
  | ({ readonly kind: 'transaction' } & ZcashTransactionRescanResult)
  | { readonly kind: 'range'; readonly checkedThrough: number; readonly complete: boolean }

const SCAN_TAB_CLASS =
  'h-9 cursor-pointer text-muted data-[state=active]:border-primary/25 data-[state=active]:bg-primary/10 data-[state=active]:text-primary'

interface ZcashRecoveryContentProps {
  readonly walletId: string
  readonly accountId: string
  readonly birthdayHeight: number
  readonly recovery?: boolean
  readonly onNavigate: (path: string) => void
  readonly close: () => void
}

export function ZcashRecoveryContent({
  walletId,
  accountId,
  birthdayHeight,
  recovery = false,
  onNavigate,
  close
}: ZcashRecoveryContentProps) {
  const [method, setMethod] = useState<'loading' | ScanMethod | 'rebuild'>(
    recovery ? 'rebuild' : 'loading'
  )
  const previousMethod = useRef<ScanMethod | null>(null)
  const fieldId = useId()
  const [txidInput, setTxidInput] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [stale, setStale] = useState(false)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const scopeChanged = useRef(false)
  const network = useRef(useWalletStore.getState().currentNetwork).current

  useEffect(() => {
    mounted.current = true
    const checkScope = (state: ReturnType<typeof useWalletStore.getState>) => {
      if (
        state.currentWalletId !== walletId ||
        state.currentAccountId !== accountId ||
        state.currentNetwork !== network ||
        !state.getAccount(walletId, accountId)
      ) {
        scopeChanged.current = true
        setStale(true)
      }
    }
    const unsubscribe = useWalletStore.subscribe(checkScope)
    checkScope(useWalletStore.getState())
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [walletId, accountId, network])

  useEffect(() => {
    if (recovery) return
    let cancelled = false
    void supportsZcashRecovery().then(supported => {
      if (!cancelled) setMethod(supported ? 'transaction' : 'rebuild')
    })
    return () => {
      cancelled = true
    }
  }, [recovery])

  const isCurrent = () => mounted.current && !scopeChanged.current
  const txid = parseZcashRecoveryTxid(txidInput)
  const startHeight = parseZcashBirthdayHeightInput(startInput)
  const endHeight = parseZcashBirthdayHeightInput(endInput)
  const invalidTxid = txidInput.trim().length > 0 && txid === null
  const invalidStart = startInput.trim().length > 0 && startHeight === null
  const invalidEnd = endInput.trim().length > 0 && endHeight === null
  const reversedRange = startHeight !== null && endHeight !== null && endHeight < startHeight
  const retryMessage =
    error ??
    (result?.kind === 'transaction' && result.status === 'unavailable'
      ? TRANSACTION_STATUS.unavailable
      : null)
  const transactionId = result?.kind === 'transaction' ? result.transactionId : undefined
  const showActivity =
    result?.kind === 'range' ||
    (result?.kind === 'transaction' &&
      (result.status === 'already-present' ||
        result.status === 'restored' ||
        (result.status === 'pending' && Boolean(transactionId))))
  const canScan =
    method === 'transaction'
      ? txid !== null
      : startHeight !== null && endHeight !== null && !reversedRange

  const clearFeedback = () => {
    setError(null)
    setResult(null)
  }

  const selectMethod = (value: ScanMethod | 'rebuild') => {
    setMethod(value)
    clearFeedback()
  }

  const handleScan = async () => {
    if (!isCurrent() || submitting.current || !canScan || showActivity) return

    submitting.current = true
    setBusy(true)
    if (!retryMessage) clearFeedback()
    try {
      if (method === 'transaction' && txid !== null) {
        const scanned = await rescanZcashTransaction({ walletId, accountId, txid })
        if (isCurrent()) {
          setError(null)
          setResult({ kind: 'transaction', ...scanned })
        }
      } else if (method === 'range' && startHeight !== null && endHeight !== null) {
        const checkedThrough = await rescanZcashRange({
          walletId,
          accountId,
          startHeight,
          endHeight
        })
        if (isCurrent()) {
          setError(null)
          setResult({ kind: 'range', checkedThrough, complete: checkedThrough === endHeight })
        }
      }
    } catch (cause) {
      if (isCurrent()) {
        setResult(null)
        setError(classifyError(cause).userMessage)
      }
    } finally {
      submitting.current = false
      if (isCurrent()) setBusy(false)
    }
  }

  if (stale) {
    return (
      <div className="space-y-3">
        <TransactionNotice message="The active account changed. Reopen Zcash recovery to continue." />
        <Button type="button" variant="secondary" size="wallet" className="w-full" onClick={close}>
          Close
        </Button>
      </div>
    )
  }

  if (method === 'loading') {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg bg-card/60 px-3 py-3 text-sm text-muted"
      >
        <Icon icon="lucide:loader-2" className="size-4 animate-spin" aria-hidden="true" />
        Checking recovery options…
      </p>
    )
  }

  if (method === 'rebuild') {
    return (
      <ResyncZcashContent
        walletId={walletId}
        accountId={accountId}
        birthdayHeight={birthdayHeight}
        recovery={recovery}
        onGetHelp={recovery ? () => onNavigate('/help') : undefined}
        onConfirm={async height => {
          if (!isCurrent()) return
          await resyncZcashWallet({ walletId, accountId, birthdayHeight: height })
          if (isCurrent()) onNavigate('/')
        }}
        close={() => {
          if (previousMethod.current) selectMethod(previousMethod.current)
          else close()
        }}
      />
    )
  }

  const partial = result?.kind === 'range' && !result.complete
  const positive = showActivity && !partial
  const isTransaction = method === 'transaction'
  const busyLabel = isTransaction ? 'Looking up transaction…' : 'Scanning blocks…'
  const scanLabel = isTransaction ? 'Find transaction' : 'Scan range'
  const notice =
    result?.kind === 'transaction'
      ? TRANSACTION_STATUS[result.status]
      : result?.kind === 'range'
        ? `${result.complete ? 'Scan complete.' : 'Scan partial.'} Checked through block ${result.checkedThrough.toLocaleString()}.`
        : null

  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault()
        void handleScan()
      }}
    >
      <Tabs
        value={method}
        activationMode="manual"
        className="gap-4"
        onValueChange={value => {
          if (!busy && (value === 'transaction' || value === 'range')) selectMethod(value)
        }}
      >
        <TabsList aria-label="Recovery method" className="h-11 w-full gap-1 bg-card/65 p-1">
          <TabsTrigger value="transaction" className={SCAN_TAB_CLASS} disabled={busy}>
            <Icon icon="lucide:code" aria-hidden="true" />
            TXID
          </TabsTrigger>
          <TabsTrigger value="range" className={SCAN_TAB_CLASS} disabled={busy}>
            <Icon icon="lucide:layers" aria-hidden="true" />
            Block range
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transaction" className="space-y-2">
          <label htmlFor={`${fieldId}-txid`} className="block text-sm font-medium">
            Transaction ID (TXID)
          </label>
          <textarea
            id={`${fieldId}-txid`}
            value={txidInput}
            onChange={event => {
              setTxidInput(event.target.value)
              clearFeedback()
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={2}
            placeholder="Paste a transaction ID"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-invalid={invalidTxid || undefined}
            aria-describedby={invalidTxid ? `${fieldId}-txid-error` : undefined}
            className="wallet-interactive block w-full resize-none break-all rounded-xl border border-input bg-card/40 px-3 py-3 font-mono text-sm leading-5 text-foreground outline-none placeholder:font-sans placeholder:text-muted enabled:hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:enabled:hover:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/25"
          />
          {invalidTxid && (
            <p id={`${fieldId}-txid-error`} className="text-xs text-danger">
              Enter a 64-character hexadecimal TXID.
            </p>
          )}
        </TabsContent>

        <TabsContent value="range" className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0 space-y-2 text-sm font-medium">
              <span className="block">Start block</span>
              <Input
                inputMode="numeric"
                value={startInput}
                onChange={event => {
                  setStartInput(event.target.value)
                  clearFeedback()
                }}
                disabled={busy}
                aria-invalid={invalidStart || undefined}
                aria-describedby={invalidStart ? `${fieldId}-range-error` : undefined}
                className="h-11 rounded-xl bg-card/40 font-mono text-sm"
              />
            </label>
            <label className="block min-w-0 space-y-2 text-sm font-medium">
              <span className="block">End block</span>
              <Input
                inputMode="numeric"
                value={endInput}
                onChange={event => {
                  setEndInput(event.target.value)
                  clearFeedback()
                }}
                disabled={busy}
                aria-invalid={invalidEnd || reversedRange || undefined}
                aria-describedby={
                  invalidEnd || reversedRange ? `${fieldId}-range-error` : undefined
                }
                className="h-11 rounded-xl bg-card/40 font-mono text-sm"
              />
            </label>
          </div>
          {(invalidStart || invalidEnd || reversedRange) && (
            <p id={`${fieldId}-range-error`} className="text-xs text-danger">
              {reversedRange
                ? 'End block must be at or after the start block.'
                : 'Enter valid whole-number block heights.'}
            </p>
          )}
        </TabsContent>
      </Tabs>

      <span role="status" className="sr-only">
        {busy && !retryMessage ? busyLabel : ''}
      </span>
      {notice && !retryMessage && (
        <TransactionNotice
          tone={partial ? 'warning' : 'muted'}
          className={cn('px-3 py-2.5 text-sm leading-5', positive && 'bg-primary/10 text-primary')}
          message={
            <span className="flex items-start gap-2">
              <Icon
                icon={positive ? 'lucide:circle-check' : 'lucide:info'}
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{notice}</span>
            </span>
          }
        />
      )}

      <div className="space-y-3">
        {retryMessage ? (
          <InlineError
            message={<span className="text-sm">{busy ? busyLabel : retryMessage}</span>}
            onRetry={() => void handleScan()}
            retrying={busy}
            tone={busy ? 'muted' : 'error'}
            className="min-h-[45px] items-center rounded-lg bg-card/60 px-3 py-2 [&>button]:text-sm"
          />
        ) : showActivity ? (
          <Button
            type="button"
            size="wallet"
            className="w-full"
            onClick={() => {
              if (isCurrent()) onNavigate(homeActivityPath('public', transactionId))
            }}
          >
            {transactionId ? 'Locate in Activity' : 'View Activity'}
          </Button>
        ) : (
          <Button
            type="submit"
            size="wallet"
            isLoading={busy}
            disabled={!canScan}
            className={cn(
              'w-full disabled:opacity-100',
              busy
                ? 'disabled:bg-primary/10 disabled:text-primary'
                : 'disabled:bg-card disabled:text-muted'
            )}
          >
            {!busy && (
              <Icon icon={isTransaction ? 'lucide:search' : 'lucide:scan'} aria-hidden="true" />
            )}
            {busy ? busyLabel : scanLabel}
          </Button>
        )}
        <div className="border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start px-2 text-muted hover:text-foreground"
            disabled={busy}
            onClick={() => {
              previousMethod.current = method
              selectMethod('rebuild')
            }}
          >
            <Icon icon="lucide:refresh-cw" aria-hidden="true" />
            Rebuild from birthday
            <Icon icon="lucide:chevron-right" className="ml-auto" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </form>
  )
}
