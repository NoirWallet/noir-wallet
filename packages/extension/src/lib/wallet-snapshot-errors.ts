/** Only failures that prove stored snapshot bytes cannot be reconstructed. */
export function isWalletSnapshotIntegrityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /^Missing chunk \d+\/\d+ for key: [^\r\n]+$/.test(message) ||
    /^Invalid wallet database snapshot: (?:inconsistent chunk manifest|invalid chunk \d+\/\d+|chunk \d+\/\d+ size mismatch|invalid snapshot bytes)$/.test(
      message
    )
  )
}
