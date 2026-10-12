export function isNativeHardwareWalletId(id: string): boolean {
  return id.startsWith('wallet:keystone-v2:') || id.startsWith('wallet:ledger-v3:')
}
