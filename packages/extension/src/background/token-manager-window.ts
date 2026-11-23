import { openWalletTab } from './wallet-tab'

export function openTokenManager(): Promise<void> {
  return openWalletTab('/manage-tokens')
}
