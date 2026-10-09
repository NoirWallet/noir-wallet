import { Checkbox } from '../ui/checkbox'
import { cn } from '@/lib/utils'

interface LabeledCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  className?: string
  disabled?: boolean
}

export function LabeledCheckbox({
  checked,
  onChange,
  label,
  className,
  disabled
}: LabeledCheckboxProps) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 cursor-pointer',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span className="text-sm text-muted select-none">{label}</span>
    </label>
  )
}
