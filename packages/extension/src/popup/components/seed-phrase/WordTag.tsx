interface WordTagProps {
  word: string
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}

export function WordTag({
  word,
  selected = false,
  disabled = false,
  onClick,
  className = ''
}: WordTagProps) {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick()
    }
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={handleClick}
      disabled={disabled}
      className={`
        inline-flex items-center px-2 py-1.5 
        bg-content1 rounded-md font-mono text-sm
        border transition-all duration-200
        ${selected ? 'border-primary text-white' : 'border-default-200 text-default-500'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-white/40'}
        ${className}
      `}
    >
      {word}
    </button>
  )
}
