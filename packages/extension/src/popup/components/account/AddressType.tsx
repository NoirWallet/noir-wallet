import { Icon } from '@iconify/react'

import { type AddressType } from '@/types/wallet'

const getAddressTypeConfig = (t: AddressType) => {
  switch (t) {
    case 'shielded':
      return {
        label: 'Shielded',
        className: 'bg-[#9500FF]/40 text-[#DEAFFF]',
        hoverClass: 'hover:bg-[#9500FF]/50'
      }
    case 'transparent':
    default:
      return {
        label: 'Transparent',
        className: 'bg-white/10 text-white',
        hoverClass: 'hover:bg-white/15'
      }
  }
}

interface AddressTypeLabelProps {
  type: AddressType
  size?: 'sm' | 'md'
  className?: string
  children?: React.ReactNode
}

/**
 * Static address type label (Shielded/Transparent) - non-interactive display
 */
export function AddressTypeLabel({
  type,
  size = 'sm',
  className,
  children
}: AddressTypeLabelProps) {
  const sizeStyles =
    size === 'sm'
      ? `${children ? 'min-w-15' : 'w-15'} px-2 py-0.5 text-[10px]`
      : 'px-3 py-1 text-xs'
  const config = getAddressTypeConfig(type)

  return (
    <span
      className={`inline-flex items-center justify-center rounded ${sizeStyles} ${config.className} ${
        className || ''
      }`}
    >
      {config.label}
      {children}
    </span>
  )
}

interface AddressTypeSwitchProps {
  type: AddressType
  onClick: () => void
  size?: 'sm' | 'md'
  ariaLabel?: string
}

/**
 * Clickable address type switch button using AddressTypeLabel
 */
export function AddressTypeSwitch({
  type,
  onClick,
  size = 'sm',
  ariaLabel
}: AddressTypeSwitchProps) {
  const iconSize = size === 'sm' ? 12 : 14

  const config = getAddressTypeConfig(type)
  const textColorClass = config.className.split(' ').find(c => c.startsWith('text-')) || ''

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className="block focus:outline-none group"
    >
      <AddressTypeLabel
        type={type}
        size={size}
        className={`flex items-center gap-1 cursor-pointer transition-colors ${config.hoverClass}`}
      >
        <Icon
          icon="lucide:chevron-down"
          width={iconSize}
          height={iconSize}
          className={`${textColorClass} shrink-0`}
        />
      </AddressTypeLabel>
    </button>
  )
}
