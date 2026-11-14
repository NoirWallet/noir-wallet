import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
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
import { resolveEvmNetworkCatalog } from '@/core/chains/evm-runtime-config'
import { useSettingsStore } from '@/store/settings-store'
import { getUtcDayStartTimestamp } from '@/lib/zcash-birthday'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { LatestAttempt } from '@/lib/async-utils'
import { toast } from '@/store/toast-store'
import { formatSortAddress, getAccountDisplayName } from '@/lib/format'
import { accountNetworksClient } from '../../services/account-networks-client'
import dayjs from '@/lib/dayjs'
import {
  isRetainedV1UpgradeAccount,
  type AccountNetworkFamily
} from '@/core/wallet/account-network-selection'
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
  const accountDisplayNames = useWalletStore(state => state.accountDisplayNames)
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const chainEndpointSettings = useSettingsStore(state => state.chainEndpointSettings)
  const loadSettings = useSettingsStore(state => state.loadSettings)
  const account = wallet?.accounts.find(item => item.id === accountId)
  const guideMode =
    params.get('guide') === 'v1' && isRetainedV1UpgradeAccount(wallet, account, currentNetwork)
  const available = useMemo(() => availableSoftwareAccountFamilies(), [])
  const builtinChains = useMemo(
    () =>
      createBuildFeatureGatedChainRegistry(
        createInitialProductChainRegistry(DEFAULT_NETWORK)
      ).list(),
    []
  )
  const chains = useMemo(
    () =>
      createBuildFeatureGatedChainRegistry(
        createInitialProductChainRegistry(
          DEFAULT_NETWORK,
          resolveEvmNetworkCatalog(DEFAULT_NETWORK, chainEndpointSettings).filter(
            network => network.source === 'custom'
          )
        )
      )
        .list()
        .filter(chain => available.includes(chain.family)),
    [available, chainEndpointSettings]
  )
  const initial =
    account?.networkChainSelections?.[DEFAULT_NETWORK] ??
    builtinChains
      .filter(chain =>
        (account?.networkSelections?.[DEFAULT_NETWORK] ?? available).includes(chain.family)
      )
      .map(chain => chain.id)
  const [selected, setSelected] = useState<readonly string[]>(initial)
  const [guideStartingChains, setGuideStartingChains] = useState<readonly string[]>(initial)
  const [successNotice, setSuccessNotice] = useState<{
    title: string
    chainName: string
    chainId: string | null
    address: string | null
  } | null>(null)
  const [history, setHistory] = useState<ZcashHistory>('new')
  const [date, setDate] = useState<dayjs.Dayjs | null>(null)
  const [height, setHeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempts = useRef(new LatestAttempt())
  const savingRef = useRef(false)
  const initializedScope = useRef<string | null>(null)

  useEffect(() => {
    void loadSettings().catch(() => {})
  }, [loadSettings])

  useEffect(() => {
    const pending = attempts.current
    return () => pending.invalidate()
  }, [])

  useEffect(() => {
    if (!successNotice) return
    const timeout = setTimeout(() => setSuccessNotice(null), 4000)
    return () => clearTimeout(timeout)
  }, [successNotice])

  useEffect(() => {
    if (!account) {
      initializedScope.current = null
      return
    }
    const scope = `${currentNetwork}:${walletId}:${accountId}`
    if (initializedScope.current === scope) return
    initializedScope.current = scope
    setSelected(
      account?.networkChainSelections?.[DEFAULT_NETWORK] ??
        builtinChains
          .filter(chain =>
            (account?.networkSelections?.[DEFAULT_NETWORK] ?? available).includes(chain.family)
          )
          .map(chain => chain.id)
    )
    setGuideStartingChains(
      account?.networkChainSelections?.[DEFAULT_NETWORK] ??
        builtinChains
          .filter(chain =>
            (account?.networkSelections?.[DEFAULT_NETWORK] ?? available).includes(chain.family)
          )
          .map(chain => chain.id)
    )
    setSuccessNotice(null)
    setHistory('new')
    setDate(null)
    setHeight('')
    setError(null)
    attempts.current.invalidate()
    savingRef.current = false
    setSaving(false)
  }, [walletId, accountId, currentNetwork, account, available, builtinChains])

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

  const save = async (nextSelected: readonly string[] = selected, returnAfterSave = true) => {
    if (savingRef.current) return
    if (
      nextSelected.length === 0 ||
      !chains.some(chain => nextSelected.includes(chain.id) !== initial.includes(chain.id))
    )
      return
    savingRef.current = true
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
        families: available.filter(family =>
          chains.some(chain => chain.family === family && nextSelected.includes(chain.id))
        ),
        chainIds: nextSelected,
        ...(birthdayHeight === undefined ? {} : { birthdayHeight })
      })
      if (!attempts.current.isCurrent(attempt)) return
      await rehydrateWalletStore()
      if (attempts.current.isCurrent(attempt)) {
        setSelected(nextSelected)
        if (returnAfterSave) {
          toast.success('Networks updated')
          goBack()
        } else {
          const added = chains.filter(
            chain => nextSelected.includes(chain.id) && !initial.includes(chain.id)
          )
          const single = added.length === 1 ? added[0] : null
          const catalog = await accountNetworksClient.getCatalog().catch(() => null)
          if (!attempts.current.isCurrent(attempt)) return
          const address = single
            ? (catalog?.accounts
                .find(item => item.walletId === walletId && item.accountId === accountId)
                ?.networks.find(network => network.chain.id === single.id)
                ?.addresses.find(candidate => candidate.preferredForReceive)?.value ?? null)
            : null
          setSuccessNotice({
            title:
              added.length === 1 ? 'New network & address added' : 'Networks & addresses added',
            chainName: single?.displayName ?? `${added.length} networks`,
            chainId: single?.id ?? null,
            address
          })
        }
      }
    } catch (cause) {
      if (attempts.current.isCurrent(attempt))
        setError(cause instanceof Error ? cause.message : 'Could not update account networks')
    } finally {
      if (attempts.current.isCurrent(attempt)) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }

  if (guideMode) {
    const currentChains = chains.filter(chain => guideStartingChains.includes(chain.id))
    const addableChains = chains.filter(chain => !guideStartingChains.includes(chain.id))
    const successChain = chains.find(chain => chain.id === successNotice?.chainId)
    const zcashAddress =
      account.networkAddresses?.[DEFAULT_NETWORK]?.transparent ?? account.addresses.transparent
    return (
      <div className="page-container">
        <PageHeader title="Add Networks" />
        <div className="page-content min-w-0 px-4 pb-4 pt-0">
          <section aria-label="Current networks">
            <h2 className="mb-3 text-sm font-medium text-muted">Currently</h2>
            <div className="space-y-2">
              {currentChains.map(chain => (
                <div
                  key={chain.id}
                  className="flex min-h-[71px] items-center gap-3 rounded-lg bg-wallet-surface px-4"
                >
                  <ChainIcon
                    chain={resolveChainIconAlias(chain.family, chain.displayName, chain.id)}
                    showTooltip={false}
                    className="size-8 shrink-0 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{chain.displayName}</p>
                    {chain.family === 'zcash' && zcashAddress && (
                      <p className="truncate text-xs text-muted">
                        {formatSortAddress(zcashAddress)}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md border border-white/20 px-2 py-1 text-sm text-muted">
                    Added
                  </span>
                </div>
              ))}
            </div>
          </section>
          {addableChains.length > 0 && (
            <section aria-label="Add networks" className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-muted">Add Networks</h2>
                <button
                  type="button"
                  disabled={saving || addableChains.every(chain => selected.includes(chain.id))}
                  onClick={() =>
                    void save(
                      chains.map(chain => chain.id),
                      false
                    )
                  }
                  className="wallet-interactive min-h-[26px] rounded-md bg-[#414152] px-2 text-sm font-medium text-white enabled:hover:bg-white/25 disabled:opacity-50"
                >
                  Add all
                </button>
              </div>
              <div className="overflow-hidden rounded-lg bg-wallet-surface">
                {addableChains.map(chain => {
                  const added = selected.includes(chain.id)
                  return (
                    <div
                      key={chain.id}
                      className="flex min-h-[72px] items-center gap-3 px-4 hover:bg-white/[0.06]"
                    >
                      <ChainIcon
                        chain={resolveChainIconAlias(chain.family, chain.displayName, chain.id)}
                        showTooltip={false}
                        className="size-8 shrink-0 rounded-md"
                      />
                      <span className="min-w-0 flex-1 truncate text-base font-medium">
                        {chain.displayName}
                      </span>
                      <button
                        type="button"
                        disabled={saving || added}
                        onClick={() => void save([...selected, chain.id], false)}
                        className={`wallet-interactive min-h-[26px] min-w-[52px] shrink-0 rounded-md px-2 text-sm font-medium ${added ? 'border border-white/20 text-muted' : 'bg-[#414152] text-white enabled:hover:bg-white/25'} disabled:cursor-default`}
                      >
                        {added ? 'Added' : 'Add'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
        <div className="page-footer space-y-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="flex items-start gap-2 text-sm leading-5 text-muted">
            <Icon icon="lucide:info" width={15} height={15} className="mt-0.5 shrink-0" />
            <span>
              Adding a network creates an address from your existing recovery phrase. No funds move.
            </span>
          </p>
          <Button className="h-[45px] w-full" disabled={saving} onClick={goBack}>
            Continue
          </Button>
        </div>
        {successNotice && (
          <div
            role="status"
            className="absolute inset-x-4 top-4 z-50 rounded-lg border border-white/10 bg-[#2b2b36] px-3 py-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#20642c] text-[#00d18a]">
                <Icon icon="lucide:check" width={16} height={16} />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium">{successNotice.title}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => setSuccessNotice(null)}
                className="flex size-6 shrink-0 items-center justify-center text-muted hover:text-white"
              >
                <Icon icon="lucide:x" width={18} height={18} />
              </button>
            </div>
            <div className="ml-8 mt-1 flex min-w-0 items-center gap-2 text-sm">
              {successNotice.chainId && (
                <ChainIcon
                  chain={
                    successChain
                      ? resolveChainIconAlias(
                          successChain.family,
                          successChain.displayName,
                          successChain.id
                        )
                      : 'evm'
                  }
                  showTooltip={false}
                  className="size-4 shrink-0 rounded"
                />
              )}
              <span className="shrink-0">{successNotice.chainName}</span>
              {successNotice.address && (
                <span className="min-w-0 truncate text-muted">
                  {formatSortAddress(successNotice.address)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader title="Networks" showBack backDisabled={saving} />
      <div className="page-content min-w-0 py-5">
        <h1 className="mb-3 truncate text-base font-medium">
          {getAccountDisplayName(walletId, accountId, account.name, accountDisplayNames)}
        </h1>
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
