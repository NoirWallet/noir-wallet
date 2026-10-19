export const MAX_ONE_CLICK_EXPIRY_DELTA_BLOCKS = 40

export function resolveOneClickExpiryDeltaBlocks(
  walletTip: number,
  networkTip: number,
  baseDeltaBlocks: number
): number {
  if (
    !Number.isSafeInteger(walletTip) ||
    walletTip <= 0 ||
    !Number.isSafeInteger(networkTip) ||
    networkTip <= 0
  ) {
    throw new Error('Wallet chain height is unavailable. Wait for sync and try again.')
  }
  const gap = Math.max(0, networkTip - walletTip)
  if (gap + baseDeltaBlocks > MAX_ONE_CLICK_EXPIRY_DELTA_BLOCKS) {
    throw new Error('Wallet is behind the network. Wait for sync and try again.')
  }
  return baseDeltaBlocks + gap
}
