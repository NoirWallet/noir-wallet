import { Icon } from '@iconify/react'
import { Checkbox } from '../ui/checkbox'
import { ChainIcon } from '../common/ChainIcon'
import type { AccountNetworkFamily } from '@/core/wallet/account-network-selection'
import { formatSortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useOnboardingTranslation } from './useOnboardingTranslation'

const familyLabels = {
  zcash: 'Zcash',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  near: 'NEAR',
  tron: 'Tron'
} satisfies Record<Exclude<AccountNetworkFamily, 'evm'>, string>

export function OnboardingNetworkChoices({
  availableFamilies,
  selectedFamilies,
  onChange,
  disabled = false,
  addressPreviews,
  addressesLoading = false
}: {
  readonly availableFamilies: readonly AccountNetworkFamily[]
  readonly selectedFamilies: readonly AccountNetworkFamily[]
  readonly onChange: (families: readonly AccountNetworkFamily[]) => void
  readonly disabled?: boolean
  readonly addressPreviews?: Readonly<Partial<Record<AccountNetworkFamily, string>>>
  readonly addressesLoading?: boolean
}) {
  const { t } = useOnboardingTranslation()
  const isImport = addressPreviews !== undefined

  return (
    <div className="space-y-1" role="group" aria-label={t('accountNetworks')}>
      {availableFamilies.map(family => {
        const checked = selectedFamilies.includes(family)
        const label = family === 'evm' ? t('evmNetworks') : familyLabels[family]
        const address = addressPreviews?.[family]

        return (
          <div key={family}>
            <label
              className={cn(
                'flex min-h-14 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-white/5',
                isImport && 'min-h-[66px] px-0'
              )}
            >
              {family === 'evm' ? (
                <span aria-hidden="true" className="grid size-8 shrink-0 grid-cols-2 gap-[2px]">
                  {(['eth', 'arb', 'avax', 'bsc'] as const).map(chain => (
                    <ChainIcon
                      key={chain}
                      chain={chain}
                      showTooltip={false}
                      className="size-[15px]"
                    />
                  ))}
                </span>
              ) : (
                <ChainIcon
                  chain={family}
                  showTooltip={false}
                  className="size-8 shrink-0 rounded-md"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', isImport && 'text-base')}>
                  {label}
                </span>
                {isImport && (
                  <span
                    className="mt-0.5 block truncate font-mono text-xs text-muted"
                    title={address}
                    aria-label={t('networkAddress', { network: label })}
                  >
                    {address ? formatSortAddress(address) : addressesLoading ? t('loading') : '—'}
                  </span>
                )}
              </span>
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={value =>
                  onChange(
                    value === true
                      ? availableFamilies.filter(
                          item => item === family || selectedFamilies.includes(item)
                        )
                      : selectedFamilies.filter(item => item !== family)
                  )
                }
                aria-label={label}
                className={cn(
                  'size-6 rounded-md data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=checked]:border-foreground',
                  isImport && 'size-5'
                )}
              />
            </label>
            {family === 'zcash' && isImport && (
              <div className="mb-2 mt-1 flex items-start gap-2 rounded-lg bg-warning-surface px-3 py-2.5 text-sm leading-5 text-warning">
                <Icon
                  icon="lucide:info"
                  width={16}
                  height={16}
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{t('zcashSyncWarning')}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
