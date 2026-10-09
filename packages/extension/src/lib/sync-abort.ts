const offscreenAbortWallets = new Set<string>()

export function registerOffscreenSyncAbortListener(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SYNC_ABORT_WALLET' && message.walletId) {
      offscreenAbortWallets.add(message.walletId)
      sendResponse({ success: true })
      return true
    }
    if (message.type === 'SYNC_CLEAR_ABORT' && message.walletId) {
      offscreenAbortWallets.delete(message.walletId)
      sendResponse({ success: true })
      return true
    }
    return false
  })
}

export function isSyncAbortRequested(walletId: string): boolean {
  return offscreenAbortWallets.has(walletId)
}

export async function signalSyncAbort(walletId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_ABORT_WALLET', walletId })
  } catch {
    /* offscreen may not be ready */
  }
}

export async function clearSyncAbort(walletId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_CLEAR_ABORT', walletId })
  } catch {
    /* offscreen may not be ready */
  }
}

export class SyncAbortedError extends Error {
  constructor(walletId: string) {
    super(`Sync aborted for wallet ${walletId}`)
    this.name = 'SyncAbortedError'
  }
}
