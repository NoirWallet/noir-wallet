export function isWalletSettlementComplete(
  caughtUp: boolean,
  scannedHeight: number,
  requiredScanHeight?: number
): boolean {
  return caughtUp && (requiredScanHeight == null || scannedHeight >= requiredScanHeight)
}
