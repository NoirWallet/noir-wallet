import { DEFAULT_NETWORK } from '@/lib/runtime-network'

export function TestnetModeBanner() {
  if (DEFAULT_NETWORK !== 'testnet') return null
  return (
    <div className="shrink-0 bg-warning/15 py-1 text-center text-xs font-semibold text-warning">
      TESTNET
    </div>
  )
}
