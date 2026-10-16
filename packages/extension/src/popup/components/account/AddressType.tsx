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
      ? 'min-w-[68px] shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px]'
      : 'whitespace-nowrap px-3 py-1 text-xs'
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
      onClick={onClick}
      className="focus:outline-none block group"
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
          className={textColorClass}
        />
      </AddressTypeLabel>
    </button>
  )
}
