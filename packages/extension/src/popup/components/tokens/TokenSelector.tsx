/**
 * Token selector component for Swap and other scenarios
 */
import { useState, useEffect } from 'react'
import { Icon } from '@iconify/react'
import { Input } from '../ui/input'
import { fetchSwapTokens, getOtherTokens, type SwapToken } from '@/core/services/intents-api'
import { formatChainName } from '@/lib/format'
import { TokenIdentity } from './TokenIdentity'

interface TokenSelectorProps {
  selectedToken?: SwapToken
  onSelect: (token: SwapToken) => void
  excludeZec?: boolean
}

export function TokenSelector({ selectedToken, onSelect, excludeZec = true }: TokenSelectorProps) {
  const [search, setSearch] = useState('')
  const [tokens, setTokens] = useState<SwapToken[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadTokens() {
      setLoading(true)
      const allTokens = await fetchSwapTokens()
      const displayTokens = excludeZec ? getOtherTokens(allTokens) : allTokens
      setTokens(displayTokens)
      setLoading(false)
    }
    loadTokens()
  }, [excludeZec])

  const filteredTokens = tokens.filter(
    t =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      formatChainName(t.blockchain).toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-[60vh] flex flex-col">
      <div className="py-4 sticky top-0 z-10">
        <Input
          type="text"
          placeholder="Search tokens"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10"
          autoFocus
          startContent={<Icon icon="lucide:search" className="text-muted" width={16} height={16} />}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Icon
              icon="lucide:loader-2"
              width={24}
              height={24}
              className="animate-spin text-muted"
            />
          </div>
        ) : filteredTokens.length === 0 ? (
          <div className="text-center py-8 text-muted">No tokens found</div>
        ) : (
          filteredTokens.map(token => (
            <button
              key={`${token.blockchain}-${token.symbol}-${token.assetId}`}
              onClick={() => onSelect(token)}
              className={`w-full flex items-center justify-between py-3 px-3 transition-colors hover:bg-card rounded-lg`}
            >
              <TokenIdentity token={token} iconSize={30} className="gap-3" />
              {selectedToken?.symbol === token.symbol &&
              selectedToken?.blockchain === token.blockchain ? (
                <Icon icon="lucide:check" width={18} height={18} className="text-primary" />
              ) : (
                <Icon icon="lucide:chevron-right" width={18} height={18} className="text-muted" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
