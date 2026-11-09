import { Checkbox } from '../ui/checkbox'
import { ChainIcon } from '../common/ChainIcon'
import evmGroupIcon from '@/images/figma-evm-group.svg'
import type { AccountNetworkFamily } from '@/core/wallet/account-network-selection'

const FAMILY_LABELS: Record<AccountNetworkFamily, string> = {
  zcash: 'Zcash',
  evm: 'Ethereum & EVM',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  near: 'NEAR',
  tron: 'Tron'
}

export function AccountNetworkFamilyChoices({
  availableFamilies,
  selectedFamilies,
  onChange,
  disabled = false
}: {
  readonly availableFamilies: readonly AccountNetworkFamily[]
  readonly selectedFamilies: readonly AccountNetworkFamily[]
  readonly onChange: (families: readonly AccountNetworkFamily[]) => void
  readonly disabled?: boolean
}) {
  return (
    <div className="space-y-1" role="group" aria-label="Account networks">
      {availableFamilies.map(family => {
        const checked = selectedFamilies.includes(family)
        return (
          <label
            key={family}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-white/5"
          >
            {family === 'evm' ? (
              <img src={evmGroupIcon} alt="" aria-hidden="true" className="size-8 shrink-0" />
            ) : (
              <ChainIcon
                chain={family}
                showTooltip={false}
                className="size-8 shrink-0 rounded-md"
              />
            )}
            <span className="min-w-0 flex-1 text-sm font-medium">{FAMILY_LABELS[family]}</span>
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
              aria-label={FAMILY_LABELS[family] ?? family}
              className="size-6 rounded-md data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=checked]:border-foreground"
            />
          </label>
        )
      })}
    </div>
  )
}
