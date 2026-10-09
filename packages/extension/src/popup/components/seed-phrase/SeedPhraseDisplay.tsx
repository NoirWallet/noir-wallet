import { Icon } from '@iconify/react'
import { Button } from '../ui/button'

interface SeedPhraseDisplayProps {
  words: string[]
  blurred?: boolean
  onReveal?: () => void
  onCopy?: () => void
}

export function SeedPhraseDisplay({ words, blurred, onReveal, onCopy }: SeedPhraseDisplayProps) {
  return (
    <div className="relative group">
      <div
        className={`grid grid-cols-3 gap-3 p-4 bg-black/40 rounded-xl border border-white/10 transition-all duration-300 ${
          blurred ? 'blur-md select-none' : ''
        }`}
      >
        {words.map((word, index) => (
          <div key={index} className="relative flex items-center">
            <span className="absolute left-3 text-xs text-muted select-none">{index + 1}.</span>
            <div className="w-full py-2.5 pl-8 pr-2 bg-card rounded-lg text-sm font-medium text-center border border-transparent">
              {word}
            </div>
          </div>
        ))}
      </div>

      {blurred && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="ghost"
              onClick={onReveal}
              className="flex flex-col items-center gap-3 text-white hover:text-primary hover:bg-transparent"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white/5 flex items-center justify-center backdrop-blur-sm">
                <Icon icon="lucide:eye-off" width={20} height={20} className="text-muted" />
              </div>
              Click to reveal seed phrase
            </Button>
          </div>
        </div>
      )}

      {onCopy && (
        <div className="absolute -top-3 right-4 z-20">
          <Button
            variant="outline"
            size="sm"
            onClick={onCopy}
            className="flex items-center gap-2 h-8 bg-background border-border hover:bg-card text-xs"
          >
            <Icon icon="lucide:copy" width={12} height={12} />
            Copy
          </Button>
        </div>
      )}
    </div>
  )
}
