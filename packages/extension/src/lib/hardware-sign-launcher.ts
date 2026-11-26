export interface HardwareSignSurface {
  readonly id: number
  readonly url: string
}

const originKey = (tabId: number) => `hardware_sign_origin:${tabId}`

export async function launchHardwareSignSurface(
  url: string,
  fromSidePanel = false
): Promise<chrome.tabs.Tab & HardwareSignSurface> {
  const [origin] = fromSidePanel
    ? await chrome.tabs.query({ active: true, currentWindow: true })
    : []
  const tab = await chrome.tabs.create({
    url,
    active: origin?.id === undefined,
    ...(origin?.id !== undefined && { windowId: origin.windowId, openerTabId: origin.id })
  })
  if (tab.id === undefined) throw new Error('Hardware signing tab opened without an ID')
  if (origin?.id !== undefined) {
    try {
      await chrome.storage.session.set({ [originKey(tab.id)]: { url, tabId: origin.id } })
    } catch (error) {
      await chrome.tabs.remove(tab.id).catch(() => {})
      throw error
    }
  }
  return { ...tab, id: tab.id, url }
}

async function activateTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true })
  if (!tab) throw new Error('Signing tab is unavailable')
  await chrome.windows.update(tab.windowId, { focused: true })
}

export async function focusHardwareSignSurface(surface: HardwareSignSurface): Promise<void> {
  const tab = await chrome.tabs.get(surface.id)
  const url = tab.pendingUrl ?? tab.url
  const matches =
    url === undefined
      ? (
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.TAB],
            tabIds: [surface.id],
            documentUrls: [surface.url]
          })
        ).length > 0
      : url === surface.url
  if (!matches) throw new Error('Signing tab is unavailable')
  await activateTab(surface.id)
}

export async function getHardwareSignOriginTab(
  tab: chrome.tabs.Tab,
  url: string | undefined
): Promise<number | undefined> {
  if (tab.id === undefined || !url) return tab.openerTabId
  const key = originKey(tab.id)
  const recorded = (await chrome.storage.session.get(key))[key]
  return recorded?.url === url && Number.isInteger(recorded.tabId)
    ? recorded.tabId
    : tab.openerTabId
}

export function registerHardwareSignOriginLifecycle(): void {
  chrome.tabs.onRemoved.addListener(tabId => {
    void chrome.storage.session.remove(originKey(tabId)).catch(() => {})
  })
}

export async function focusHardwareSignOrigin(): Promise<boolean> {
  const tab = await chrome.tabs.getCurrent()
  if (!tab) return false
  const originTabId = await getHardwareSignOriginTab(tab, location.href)
  if (originTabId === undefined) return false
  await activateTab(originTabId)
  return true
}

export function waitForHardwareSignSurfaceClose(tabId: number): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      chrome.tabs.onRemoved.removeListener(onRemoved)
      resolve()
    }
    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) finish()
    }
    chrome.tabs.onRemoved.addListener(onRemoved)
    void chrome.tabs.get(tabId).catch(finish)
  })
}
