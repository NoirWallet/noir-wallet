import { DedupPromise } from '@/lib/async-utils'

const openings = new Map<string, DedupPromise<void>>()

/** Focuses the wallet tab already showing `hashPath`, or opens a new one. */
export function openWalletTab(hashPath: string): Promise<void> {
  let opening = openings.get(hashPath)
  if (!opening) {
    opening = new DedupPromise<void>()
    openings.set(hashPath, opening)
  }
  return opening.run(async () => {
    const url = chrome.runtime.getURL(`index.html#${hashPath}`)
    // tabs.get omits even our own extension URL without the broad tabs permission.
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.TAB],
      documentOrigins: [new URL(url).origin]
    })
    const current = contexts.find(context => context.documentUrl === url && context.tabId >= 0)
    if (current) {
      await chrome.tabs.update(current.tabId, { active: true })
      if (current.windowId >= 0) await chrome.windows.update(current.windowId, { focused: true })
      return
    }
    await chrome.tabs.create({ url, active: true })
  })
}
