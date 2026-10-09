import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tooltip } from '../ui/tooltip'
import { formatSortAddress } from '@/lib/format'
import type { ShieldedReceiveAddress } from '@/types'

interface ShieldedAddressHistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  addresses: ShieldedReceiveAddress[]
  currentAddress: string
  loading: boolean
  error: string | null
  selectingAddress: string | null
  onRetry: () => void
  onSelect: (address: string) => void
  onCopy: (address: string) => void
}

interface ShieldedAddressHistoryButtonProps {
  onClick: () => void
  disabled?: boolean
}

export function ShieldedAddressHistoryButton({
  onClick,
  disabled = false
}: ShieldedAddressHistoryButtonProps) {
  return (
    <Tooltip content="View shielded address history">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        disabled={disabled}
        aria-label="View shielded address history"
      >
        <Icon icon="lucide:history" width={18} height={18} />
      </Button>
    </Tooltip>
  )
}

export function ShieldedAddressHistorySheet({
  open,
  onOpenChange,
  addresses,
  currentAddress,
  loading,
  error,
  selectingAddress,
  onRetry,
  onSelect,
  onCopy
}: ShieldedAddressHistorySheetProps) {
  const current = addresses.find(address => address.shielded === currentAddress)
  const ordered = [
    ...(current ? [current] : []),
    ...addresses.filter(address => address.shielded !== currentAddress).reverse()
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="bottom"
        className="max-h-[78vh] grid-rows-[auto_minmax(0,1fr)] p-0 gap-0"
      >
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/10">
          <DialogTitle className="text-center">Shielded Addresses</DialogTitle>
          <DialogDescription className="sr-only">
            Choose the default shielded receiving address
          </DialogDescription>
        </DialogHeader>

        <div
          role="region"
          aria-label="Shielded address history"
          className="min-h-0 overflow-y-auto px-4 py-4"
        >
          {loading && addresses.length === 0 ? (
            <div className="h-28 flex items-center justify-center" role="status">
              <Icon icon="lucide:loader-circle" width={22} height={22} className="animate-spin" />
              <span className="sr-only">Loading shielded addresses</span>
            </div>
          ) : error && addresses.length === 0 ? (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
              <Button variant="outline" onClick={onRetry} className="h-9 px-5">
                Retry
              </Button>
            </div>
          ) : ordered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No shielded addresses</p>
          ) : (
            <div className="space-y-2">
              {ordered.map(address => {
                const isCurrent = address.shielded === currentAddress
                const isSelecting = selectingAddress === address.shielded
                return (
                  <div
                    key={address.shielded}
                    className={`flex items-center gap-2 rounded-lg border p-2 ${
                      isCurrent ? 'bg-primary/10 border-primary/40' : 'bg-card border-white/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(address.shielded)}
                      disabled={isCurrent || selectingAddress !== null}
                      className="min-w-0 flex-1 px-1.5 py-1.5 text-left disabled:cursor-default"
                      aria-label="Use this shielded address"
                    >
                      <span className="flex items-center gap-2">
                        <Icon
                          icon={isCurrent ? 'lucide:circle-check' : 'lucide:circle'}
                          width={16}
                          height={16}
                          className={isCurrent ? 'text-primary shrink-0' : 'text-muted shrink-0'}
                        />
                        <span className="min-w-0 font-mono text-sm text-white/90">
                          {formatSortAddress(address.shielded)}
                        </span>
                        {isCurrent && <span className="text-xs text-primary">Current</span>}
                        {isSelecting && (
                          <Icon
                            icon="lucide:loader-circle"
                            width={15}
                            height={15}
                            className="ml-auto shrink-0 animate-spin text-primary"
                          />
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopy(address.shielded)}
                      disabled={selectingAddress !== null}
                      className="shrink-0 p-2 rounded-lg text-muted hover:text-white hover:bg-white/10 disabled:opacity-40"
                      aria-label="Copy shielded address"
                    >
                      <Icon icon="lucide:copy" width={16} height={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
