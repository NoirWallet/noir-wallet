import { useState } from 'react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

export function SlippageSettingContent({
  currentSlippage,
  onSave
}: {
  currentSlippage: number
  onSave: (slippage: number) => void
}) {
  const [slippage, setSlippage] = useState(currentSlippage.toString())
  const presets = [0.5, 1, 2, 3]

  return (
    <div className="py-4">
      <p className="text-sm text-muted mb-4">
        Set the maximum price difference you're willing to accept. Higher slippage means faster
        execution but may result in a worse rate.
      </p>

      <div className="flex gap-2 mb-4">
        {presets.map(preset => (
          <button
            key={preset}
            onClick={() => setSlippage(preset.toString())}
            className={`min-w-12 flex-1 shrink-0 py-2 rounded-lg text-sm font-medium transition-colors ${
              parseFloat(slippage) === preset
                ? 'bg-primary text-black'
                : 'bg-card text-white hover:bg-white/10'
            }`}
          >
            {preset}%
          </button>
        ))}
        <Input
          type="text"
          value={slippage}
          onChange={e => setSlippage(e.target.value.replace(/[^0-9.]/g, ''))}
          className="bg-card rounded-lg border-none text-center pr-6"
          classNames={{ wrapper: 'w-auto' }}
          endContent={<span className="text-sm text-muted">%</span>}
        />
      </div>

      <Button
        onClick={() => onSave(parseFloat(slippage) || 1)}
        className="w-full h-[50px] bg-primary hover:bg-primary/90 text-black font-semibold rounded-xl"
      >
        Save
      </Button>
    </div>
  )
}
