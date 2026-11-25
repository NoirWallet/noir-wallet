export type OneClickChainFamily = 'evm' | 'solana' | 'near' | 'btc' | 'zcash'

export interface OneClickViewer {
  readonly chainFamily: OneClickChainFamily
  readonly walletAddress: string
  readonly signingMode?: 'derived' | 'transparent' | 'public' | 'private'
}

export interface OneClickOrder {
  readonly depositAddress: string
  readonly depositMemo?: string
  readonly viewer?: OneClickViewer
}

export function oneClickQuoteViewerFields(viewer?: OneClickViewer): {
  user?: string
  userChainFamily?: OneClickChainFamily
} {
  if (!viewer || viewer.signingMode === 'private') return {}
  return { user: viewer.walletAddress, userChainFamily: viewer.chainFamily }
}
