import { useEffect } from 'react'
import { BLOCK_EXPLORER_GROUPS } from '@/config/block-explorers'
import { useSettingsStore } from '@/store/settings-store'
import { ChainIcon } from '../../components/common/ChainIcon'
import { PageHeader } from '../../components/common/PageHeader'
import { DEFAULT_NETWORK, getNetworkConfig } from '@/config/networks'

const isFixedTestnetExplorer = DEFAULT_NETWORK === 'testnet'
const displayedBlockExplorerGroups = isFixedTestnetExplorer
  ? [
      {
        chain: 'zcash' as const,
        label: 'Zcash Testnet',
        iconChain: 'zec',
        options: [
          {
            id: 'blockchair' as const,
            label: 'Cipherscan Testnet',
            baseUrl: getNetworkConfig('testnet').explorerUrl,
            transactionPath: 'tx'
          }
        ]
      }
    ]
  : BLOCK_EXPLORER_GROUPS

export function PreferredExplorer() {
  const { blockExplorerPreferences, setBlockExplorerPreference, loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return (
    <div className="page-container">
      <PageHeader title="Preferred Explorer" showBack />

      <div className="page-content space-y-6">
        {displayedBlockExplorerGroups.map(group => (
          <section key={group.chain} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-full bg-white flex items-center justify-center overflow-hidden">
                <ChainIcon chain={group.iconChain} className="size-6" />
              </div>
              <h2 className="text-base font-medium text-white">{group.label}</h2>
            </div>

            <div className="overflow-hidden rounded-xl bg-card">
              {group.options.map((option, index) => {
                const isSelected =
                  isFixedTestnetExplorer || blockExplorerPreferences[group.chain] === option.id

                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isFixedTestnetExplorer}
                    onClick={() => {
                      if (!isFixedTestnetExplorer) {
                        setBlockExplorerPreference(group.chain, option.id)
                      }
                    }}
                    className={`w-full min-h-11 px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors hover:bg-white/5 ${
                      index > 0 ? 'border-t border-white/10' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-white">{option.label}</span>
                      <span className="block text-xs text-muted truncate">
                        {option.baseUrl.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                    <span
                      className={`size-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-primary bg-primary/15' : 'border-white/15 bg-white/5'
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {isFixedTestnetExplorer && (
          <p className="text-xs text-muted">
            Testnet builds use Cipherscan Testnet for transaction links.
          </p>
        )}
      </div>
    </div>
  )
}
