import { UI_CONFIG } from '@/config/extension'

export type HardwareSignPresentation = 'tab' | 'window'

/** Keep panel-origin signing alive without replacing the tab that owns the panel. */
export async function launchHardwareSignSurface(
  url: string,
  presentation: HardwareSignPresentation
): Promise<chrome.tabs.Tab & { id: number }> {
  if (presentation === 'tab') {
    const tab = await chrome.tabs.create({ url })
    if (typeof tab.id === 'number') return tab as chrome.tabs.Tab & { id: number }
    throw new Error('Hardware signing tab opened without an ID')
  }

  const signWindow = await chrome.windows.create({
    url,
    type: 'popup',
    width: UI_CONFIG.DAPP_WINDOW.WIDTH,
    height: UI_CONFIG.DAPP_WINDOW.HEIGHT,
    focused: true
  })
  const createdTab = signWindow.tabs?.[0]
  if (typeof createdTab?.id === 'number') return createdTab as chrome.tabs.Tab & { id: number }

  if (typeof signWindow.id === 'number') {
    const tabs = await chrome.tabs.query({ windowId: signWindow.id })
    if (typeof tabs[0]?.id === 'number') return tabs[0] as chrome.tabs.Tab & { id: number }
  }

  throw new Error('Hardware signing window opened without a tab')
}
