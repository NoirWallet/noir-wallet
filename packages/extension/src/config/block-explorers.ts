export type BlockExplorerChain = 'zcash'
export type ZcashBlockExplorerId = 'blockchair' | 'zcashexplorer'
export type BlockExplorerId = ZcashBlockExplorerId

export interface BlockExplorerOption {
  id: BlockExplorerId
  label: string
  baseUrl: string
  transactionPath: string
}

export interface BlockExplorerGroup {
  chain: BlockExplorerChain
  label: string
  iconChain: string
  options: BlockExplorerOption[]
}

export type BlockExplorerPreferences = Record<BlockExplorerChain, BlockExplorerId>

export const DEFAULT_BLOCK_EXPLORER_PREFERENCES: BlockExplorerPreferences = {
  zcash: 'blockchair'
}

export const BLOCK_EXPLORER_GROUPS: BlockExplorerGroup[] = [
  {
    chain: 'zcash',
    label: 'Zcash',
    iconChain: 'zec',
    options: [
      {
        id: 'blockchair',
        label: 'Blockchair',
        baseUrl: 'https://blockchair.com/zcash',
        transactionPath: 'transaction'
      },
      {
        id: 'zcashexplorer',
        label: 'Zcash Explorer',
        baseUrl: 'https://mainnet.zcashexplorer.app',
        transactionPath: 'transactions'
      }
    ]
  }
]

const blockExplorerOptionsByChain = BLOCK_EXPLORER_GROUPS.reduce(
  (acc, group) => {
    acc[group.chain] = group.options
    return acc
  },
  {} as Record<BlockExplorerChain, BlockExplorerOption[]>
)

let activeBlockExplorerPreferences: BlockExplorerPreferences = {
  ...DEFAULT_BLOCK_EXPLORER_PREFERENCES
}

export function setActiveBlockExplorerPreferences(preferences?: Partial<BlockExplorerPreferences>) {
  activeBlockExplorerPreferences = {
    ...DEFAULT_BLOCK_EXPLORER_PREFERENCES,
    ...preferences
  }
}

export function getBlockExplorerBaseUrl(chain: BlockExplorerChain): string {
  return getActiveBlockExplorerOption(chain)?.baseUrl || ''
}

export function getBlockExplorerTransactionPath(chain: BlockExplorerChain): string {
  return getActiveBlockExplorerOption(chain)?.transactionPath || ''
}

function getActiveBlockExplorerOption(chain: BlockExplorerChain): BlockExplorerOption | undefined {
  const selectedId =
    activeBlockExplorerPreferences[chain] || DEFAULT_BLOCK_EXPLORER_PREFERENCES[chain]
  const selectedOption = blockExplorerOptionsByChain[chain]?.find(
    option => option.id === selectedId
  )
  const defaultOption = blockExplorerOptionsByChain[chain]?.find(
    option => option.id === DEFAULT_BLOCK_EXPLORER_PREFERENCES[chain]
  )

  return selectedOption || defaultOption
}
