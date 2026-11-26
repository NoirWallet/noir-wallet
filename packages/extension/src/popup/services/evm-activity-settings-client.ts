import type { Network } from '@/types'

export async function clearEvmActivity(target: {
  readonly networkMode: Network
  readonly chainId: string
  readonly walletId: string
  readonly accountId: string
}): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'CLEAR_EVM_ACTIVITY', ...target })
  if (response?.result !== true) {
    throw new Error(
      typeof response?.error === 'string'
        ? response.error
        : 'Check the account and network and try again.'
    )
  }
}
