import {
  EXTENSION_POPUP_PATH,
  EXTENSION_SIDE_PANEL_PATH,
  readStoredExtensionDisplayMode
} from '@/config/extension-display'
import { EXTENSION_DISPLAY_MODE_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '@/config/storage-keys'

interface SidePanelApi {
  setOptions(options: { enabled: boolean; path: string }): Promise<void>
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>
}

interface PersistedSettings extends Record<string, unknown> {
  state: Record<string, unknown>
}

let displayModeUpdateQueue = Promise.resolve()
let appliedSidePanelMode = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePersistedSettings(value: unknown): PersistedSettings | null {
  if (value === undefined || value === null) {
    return { state: {}, version: 0 }
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!isRecord(parsed) || !isRecord(parsed.state)) return null

    return { ...parsed, state: parsed.state }
  } catch {
    return null
  }
}

function getSidePanelApi(): SidePanelApi | undefined {
  return (chrome as typeof chrome & { sidePanel?: SidePanelApi }).sidePanel
}

export function readSidePanelMode(value: unknown): boolean | null {
  const sidePanelMode = parsePersistedSettings(value)?.state.sidePanelMode
  return typeof sidePanelMode === 'boolean' ? sidePanelMode : null
}

export function getAppliedSidePanelMode(): boolean {
  return appliedSidePanelMode
}

export function enqueueExtensionDisplayModeUpdate<T>(update: () => Promise<T>): Promise<T> {
  const result = displayModeUpdateQueue.then(update, update)
  displayModeUpdateQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export async function persistSidePanelMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({
    [EXTENSION_DISPLAY_MODE_STORAGE_KEY]: { sidePanelMode: enabled }
  })
}

export async function readPersistedSidePanelMode(): Promise<boolean> {
  const stored = await chrome.storage.local.get([
    EXTENSION_DISPLAY_MODE_STORAGE_KEY,
    SETTINGS_STORAGE_KEY
  ])
  const storedMode = readStoredExtensionDisplayMode(stored[EXTENSION_DISPLAY_MODE_STORAGE_KEY])
  if (storedMode !== null) return storedMode

  const initialMode = readSidePanelMode(stored[SETTINGS_STORAGE_KEY]) ?? true
  await persistSidePanelMode(initialMode)
  return initialMode
}

export async function applyExtensionDisplayMode(sidePanelMode: boolean): Promise<void> {
  const sidePanel = getSidePanelApi()

  if (!sidePanelMode) {
    await chrome.action.setPopup({ popup: EXTENSION_POPUP_PATH })
    if (sidePanel) {
      await sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
      sidePanel.setOptions({ path: EXTENSION_SIDE_PANEL_PATH, enabled: false }).catch(error => {
        console.warn('[Background] Failed to disable side panel:', error)
      })
    }
    appliedSidePanelMode = false
    return
  }

  if (!sidePanel) {
    throw new Error('Side panel mode is not supported by this browser')
  }

  try {
    await sidePanel.setOptions({ path: EXTENSION_SIDE_PANEL_PATH, enabled: true })
    await sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    await chrome.action.setPopup({ popup: '' })
    appliedSidePanelMode = true
  } catch (error) {
    await Promise.allSettled([
      chrome.action.setPopup({ popup: EXTENSION_POPUP_PATH }),
      sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
      sidePanel.setOptions({ path: EXTENSION_SIDE_PANEL_PATH, enabled: false })
    ])
    throw error
  }
}

export async function initializeExtensionDisplayMode(): Promise<void> {
  await applyExtensionDisplayMode(await readPersistedSidePanelMode())
}
