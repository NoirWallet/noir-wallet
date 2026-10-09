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
