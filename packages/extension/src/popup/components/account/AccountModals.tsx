import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { DatePicker } from '../ui/date-picker'
import { accountManager } from '@/core/wallet/account-manager'
import dayjs from '@/lib/dayjs'
import {
  formatBirthdayResyncHint,
  getBirthdayDateFromBlockTimestamp,
  getUtcDayStartTimestamp,
  type BirthdayHeightSource
} from '@/lib/zcash-birthday'
import { classifyError } from '@/lib/errors'

interface RenameAccountContentProps {
  walletId: string
  accountId: string
  currentName: string
  close: () => void
}

export function RenameAccountContent({
  walletId,
  accountId,
  currentName,
  close
}: RenameAccountContentProps) {
  const [name, setName] = useState(currentName)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (trimmedName && trimmedName !== currentName) {
      setIsSaving(true)
      try {
        await accountManager.renameAccount(walletId, accountId, trimmedName)
        close()
      } catch (e) {
        console.error('Failed to rename account:', e)
        setIsSaving(false)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-muted mb-2">Account name</label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter account name"
          className="h-[46px] rounded-xl"
          autoFocus
        />
      </div>

      <Button
        disabled={!name.trim() || name.trim() === currentName || isSaving}
        onClick={handleSave}
        isLoading={isSaving}
        className="w-full h-[45px]"
      >
        Confirm
      </Button>
    </div>
  )
}

type ResyncEditMode = 'height' | 'date'

interface ResyncWalletContentProps {
  walletId: string
  accountId: string
  birthdayHeight: number
  onConfirm: (height: number) => Promise<void>
  close: () => void
}

export function ResyncWalletContent({
  walletId,
  accountId,
  birthdayHeight,
  onConfirm,
  close
}: ResyncWalletContentProps) {
  const [editMode, setEditMode] = useState<ResyncEditMode>('height')
  const [resolvedHeight, setResolvedHeight] = useState(birthdayHeight)
  const [editHeight, setEditHeight] = useState(birthdayHeight > 0 ? birthdayHeight.toString() : '')
  const [syncDate, setSyncDate] = useState<dayjs.Dayjs | null>(null)
  const [heightSource, setHeightSource] = useState<BirthdayHeightSource>('none')
  const [blockTimestamp, setBlockTimestamp] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      let height = birthdayHeight
      let source: BirthdayHeightSource = birthdayHeight > 0 ? 'stored' : 'none'

      if (height <= 0) {
        const resolved = await accountManager.resolveBirthdayHeight(walletId, accountId)
        height = resolved.height
        source = resolved.source
      }

      if (cancelled) return

      if (height <= 0) {
        setResolvedHeight(0)
        setEditHeight('')
        setSyncDate(null)
        setHeightSource('none')
        setBlockTimestamp(null)
        return
      }

      setResolvedHeight(height)
      setEditHeight(height.toString())
      setHeightSource(source)

      if (source === 'fallback') {
        setSyncDate(null)
        setBlockTimestamp(null)
        return
      }

      try {
        const timestamp = await accountManager.getBlockTime(height)
        if (cancelled) return
        setBlockTimestamp(timestamp)
        setSyncDate(getBirthdayDateFromBlockTimestamp(timestamp))
      } catch {
        if (!cancelled) {
          setSyncDate(null)
          setBlockTimestamp(null)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [walletId, accountId, birthdayHeight])

  const handleResync = async () => {
    setError(null)
    setIsLoading(true)

    try {
      let height: number

      if (editMode === 'date') {
        if (!syncDate) {
          height = resolvedHeight
        } else {
          const timestamp = getUtcDayStartTimestamp(syncDate)
          height = await accountManager.getBlockByTime(timestamp)
        }
      } else {
        height = parseInt(editHeight, 10)
        if (isNaN(height) || height < 0) return
      }

      await onConfirm(height)
    } catch (e) {
      console.error('Resync failed:', e)
      setError(classifyError(e).userMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex gap-3 mb-3">
          <button
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              editMode === 'height'
                ? 'bg-primary/15 text-primary'
                : 'bg-card text-muted hover:text-text'
            }`}
            onClick={() => {
              setEditMode('height')
              setError(null)
            }}
          >
            Birthday Height
          </button>
          <button
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              editMode === 'date'
                ? 'bg-primary/15 text-primary'
                : 'bg-card text-muted hover:text-text'
            }`}
            onClick={() => {
              setEditMode('date')
              setError(null)
            }}
          >
            By Date
          </button>
        </div>

        {editMode === 'height' ? (
          <>
            <Input
              type="number"
              value={editHeight}
              onChange={e => setEditHeight(e.target.value)}
              placeholder="e.g. 1000000"
              className="h-[46px] rounded-xl"
            />
            <p className="text-xs text-muted mt-1.5">
              {formatBirthdayResyncHint(resolvedHeight, blockTimestamp, heightSource)}
            </p>
          </>
        ) : (
          <>
            <DatePicker
              value={syncDate}
              onChange={setSyncDate}
              ariaLabel="Wallet birthday date"
              placeholder="Select wallet creation date"
            />
            <p className="text-xs text-muted mt-1.5">
              Resyncs all accounts from this date; choose an earlier date if you are unsure.
            </p>
          </>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-3 pt-1">
        <Button variant="outline" onClick={close} disabled={isLoading} className="flex-1 h-[45px]">
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={handleResync}
          isLoading={isLoading}
          disabled={editMode === 'height' && (!editHeight || parseInt(editHeight, 10) < 0)}
          className="flex-1 h-[45px]"
        >
          Resync
        </Button>
      </div>
    </div>
  )
}
