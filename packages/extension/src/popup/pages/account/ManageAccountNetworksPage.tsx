import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { DatePicker } from '../../components/ui/date-picker'
import { ChainIcon } from '../../components/common/ChainIcon'
import { useNavigate } from '../../provider/Router'
import { useDialog } from '../../hooks/useDialog'
import { switchWalletAccount } from '../../services/account-switch'
import { useWalletStore, rehydrateWalletStore } from '@/store/wallet-store'
import {
  availableSoftwareAccountFamilies,
  setAccountNetworkSelection
} from '../../services/account-network-selection-client'
import { getFullZcashRecoveryBirthdayHeight } from '@/core/wallet/birthday-height'
import { zcashWalletRuntimeClient } from '../../services/zcash-wallet-runtime-client'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { getUtcDayStartTimestamp } from '@/lib/zcash-birthday'
import { LatestAttempt } from '@/lib/async-utils'
import { toast } from '@/store/toast-store'
import dayjs from '@/lib/dayjs'
import type { AccountNetworkFamily } from '@/core/wallet/account-network-selection'
import {
  createBuildFeatureGatedChainRegistry,
  createInitialProductChainRegistry
} from '@/core/chains/registry'

type ZcashHistory = 'new' | 'date' | 'height'

export function ManageAccountNetworksPage() {
  const { goBack } = useNavigate()
  const { confirm } = useDialog()
  const [params] = useSearchParams()
  const walletId = params.get('walletId')
  const accountId = params.get('accountId')
  const wallet = useWalletStore(state => state.wallets.find(item => item.id === walletId))
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const account = wallet?.accounts.find(item => item.id === accountId)
  const available = useMemo(() => availableSoftwareAccountFamilies(), [])
  const chains = useMemo(
    () =>
      createBuildFeatureGatedChainRegistry(createInitialProductChainRegistry(DEFAULT_NETWORK))
        .list()
        .filter(chain => available.includes(chain.family)),
    [available]
  )
  const initial =
    account?.networkChainSelections?.[DEFAULT_NETWORK] ??
    chains
      .filter(chain =>
        (account?.networkSelections?.[DEFAULT_NETWORK] ?? available).includes(chain.family)
      )
      .map(chain => chain.id)
  const [selected, setSelected] = useState<readonly string[]>(initial)
  const [history, setHistory] = useState<ZcashHistory>('new')
  const [date, setDate] = useState<dayjs.Dayjs | null>(null)
  const [height, setHeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempts = useRef(new LatestAttempt())

  useEffect(() => {
    const pending = attempts.current
    return () => pending.invalidate()
  }, [])

  useEffect(() => {
    setSelected(
      account?.networkChainSelections?.[DEFAULT_NETWORK] ??
        chains
          .filter(chain =>
            (account?.networkSelections?.[DEFAULT_NETWORK] ?? available).includes(chain.family)
          )
          .map(chain => chain.id)
    )
    setHistory('new')
    setDate(null)
    setHeight('')
    setError(null)
    attempts.current.invalidate()
    setSaving(false)
  }, [walletId, accountId, available, chains])

  if (
    !walletId ||
    !accountId ||
    !account ||
    (wallet?.keySource !== undefined && wallet.keySource !== 'software')
  ) {
    return (
      <div className="page-container">
        <PageHeader title="Networks" showBack />
        <div className="page-content flex items-center justify-center text-sm text-muted">
          Account unavailable
        </div>
      </div>
    )
  }

  const selectedFamilies: readonly AccountNetworkFamily[] = available.filter(family =>
    chains.some(chain => chain.family === family && selected.includes(chain.id))
  )
  const enablingZcash =
    selectedFamilies.includes('zcash') &&
    account.networkSelections?.[DEFAULT_NETWORK]?.includes('zcash') === false
  const choosingZcashHistory =
    enablingZcash &&
    !((account.networkBirthdayHeights?.[DEFAULT_NETWORK] ?? 0) > 0) &&
    !account.networkZcashHistoryConfigured?.[DEFAULT_NETWORK]
  const recoveryFloor = getFullZcashRecoveryBirthdayHeight(DEFAULT_NETWORK)
  const changed = chains.some(chain => selected.includes(chain.id) !== initial.includes(chain.id))

  const save = async () => {
    if (!changed || selected.length === 0) return
    const attempt = attempts.current.begin()
    const startingWalletId = currentWalletId
    const startingAccountId = currentAccountId
    setSaving(true)
    setError(null)
    try {
      let birthdayHeight: number | undefined
      if (choosingZcashHistory && history === 'height') {
        const normalized = height.replace(/,/g, '').trim()
        birthdayHeight = Number(normalized)
        if (
          !/^\d+$/.test(normalized) ||
          !Number.isSafeInteger(birthdayHeight) ||
          birthdayHeight < recoveryFloor
        ) {
          throw new Error(`Enter a block height of ${recoveryFloor.toLocaleString()} or later.`)
        }
      } else if (choosingZcashHistory && history === 'date') {
        if (!date) throw new Error('Select the approximate date of the first ZEC transaction.')
        birthdayHeight = await zcashWalletRuntimeClient.getBlockByTime(
          getUtcDayStartTimestamp(date)
        )
        if (!Number.isSafeInteger(birthdayHeight) || birthdayHeight <= 0) {
          throw new Error('The Zcash network returned an invalid block height. Please try again.')
        }
        birthdayHeight = Math.max(recoveryFloor, birthdayHeight)
      }
      if (!attempts.current.isCurrent(attempt)) return
      const current = useWalletStore.getState()
      if (
        current.currentWalletId !== startingWalletId ||
        current.currentAccountId !== startingAccountId
      ) {
        throw new Error('Active account changed. Review networks and try again.')
      }
      if (current.currentWalletId !== walletId || current.currentAccountId !== accountId) {
        const switched = await switchWalletAccount({
          walletId,
          accountId,
          currentWalletId: current.currentWalletId,
          currentAccountId: current.currentAccountId,
          confirm
        })
        if (!switched || !attempts.current.isCurrent(attempt)) return
      }
      await setAccountNetworkSelection({
        walletId,
        accountId,
        families: selectedFamilies,
        chainIds: selected,
        ...(birthdayHeight === undefined ? {} : { birthdayHeight })
      })
      if (!attempts.current.isCurrent(attempt)) return
      await rehydrateWalletStore()
      if (attempts.current.isCurrent(attempt)) {
        toast.success('Networks updated')
        goBack()
      }
    } catch (cause) {
      if (attempts.current.isCurrent(attempt))
        setError(cause instanceof Error ? cause.message : 'Could not update account networks')
    } finally {
      if (attempts.current.isCurrent(attempt)) setSaving(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Networks" showBack backDisabled={saving} />
      <div className="page-content min-w-0 py-5">
        <h1 className="mb-3 truncate text-base font-medium">{account.name}</h1>
        <div className="space-y-5">
          <section aria-label="Current networks">
            <h2 className="mb-2 text-sm font-medium">Currently</h2>
            <div className="space-y-1">
              {chains
                .filter(chain => selected.includes(chain.id))
                .map(chain => (
                  <button
                    key={chain.id}
                    type="button"
                    disabled={saving || selected.length === 1}
                    onClick={() => setSelected(current => current.filter(id => id !== chain.id))}
                    className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-white/5 disabled:opacity-60"
                  >
                    <ChainIcon
                      chain={chain.family}
                      showTooltip={false}
                      className="size-7 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{chain.displayName}</span>
                    <span className="text-xs text-primary">
                      {initial.includes(chain.id) ? 'Added' : 'Selected'}
                    </span>
                  </button>
                ))}
            </div>
          </section>
          {chains.some(chain => !selected.includes(chain.id)) && (
            <section aria-label="Add networks">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">Add Networks</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setSelected(chains.map(chain => chain.id))}
                >
                  Add all
                </Button>
              </div>
              <div className="space-y-1">
                {chains
                  .filter(chain => !selected.includes(chain.id))
                  .map(chain => (
                    <button
                      key={chain.id}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setSelected(current => [...current, chain.id])
                        setError(null)
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-white/5"
                    >
                      <ChainIcon
                        chain={chain.family}
                        showTooltip={false}
                        className="size-7 shrink-0 rounded"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{chain.displayName}</span>
                      <span className="text-xs text-primary">Add</span>
                    </button>
                  ))}
              </div>
            </section>
          )}
        </div>
        {choosingZcashHistory && (
          <div className="mt-5 border-t border-border pt-4">
            <h2 className="text-sm font-medium">Zcash history</h2>
            <div
              role="radiogroup"
              aria-label="Zcash history"
              className="mt-3 grid grid-cols-3 gap-2"
            >
              {(
                [
                  ['new', 'New'],
                  ['date', 'Date'],
                  ['height', 'Block height']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={history === value}
                  disabled={saving}
                  onClick={() => setHistory(value)}
                  className={`min-h-10 rounded-md border px-2 text-xs ${history === value ? 'border-primary text-foreground' : 'border-border text-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {history === 'date' && (
              <div className="mt-4">
                <label className="mb-2 block text-sm text-muted">First ZEC transaction</label>
                <DatePicker
                  value={date}
                  onChange={setDate}
                  minDate={dayjs(DEFAULT_NETWORK === 'mainnet' ? '2018-10-01' : '2018-01-01')}
                  ariaLabel="First ZEC transaction date"
                />
              </div>
            )}
            {history === 'height' && (
              <div className="mt-4">
                <label className="mb-2 block text-sm text-muted">Zcash block height</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={height}
                  onChange={event => setHeight(event.target.value)}
                  placeholder={`At least ${recoveryFloor.toLocaleString()}`}
                  aria-label="Zcash birthday height"
                />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="page-footer">
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          className="h-[45px] w-full"
          disabled={!changed || selected.length === 0 || saving}
          isLoading={saving}
          onClick={() => void save()}
        >
          {currentWalletId === walletId && currentAccountId === accountId
            ? 'Continue'
            : 'Switch account and continue'}
        </Button>
      </div>
    </div>
  )
}
