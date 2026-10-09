/**
 * Window Manager
 * Manages popup windows to ensure single-window policy
 */

import { sleep } from '@/lib/utils'

/**
 * Close all existing popup windows
 * Ensures single-window policy for wallet operations
 */
export async function closeAllPopupWindows(): Promise<void> {
  const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB, chrome.runtime.ContextType.POPUP],
    documentOrigins: [extensionOrigin]
  })
  const windowIds = new Set(
    contexts.flatMap(context => (typeof context.windowId === 'number' ? [context.windowId] : []))
  )

  for (const windowId of windowIds) {
    try {
      const win = await chrome.windows.get(windowId)
      if (win.type === 'popup') {
        await chrome.windows.remove(windowId)
      }
    } catch (e) {
      // Window may already be closed
    }
  }

  await sleep(100)
}
