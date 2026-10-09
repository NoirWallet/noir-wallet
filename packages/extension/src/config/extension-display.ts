export const EXTENSION_POPUP_PATH = 'index.html'
export const EXTENSION_SIDE_PANEL_PATH = 'index.html?surface=side-panel'

export function isSidePanelSurface(search: string): boolean {
  return new URLSearchParams(search).get('surface') === 'side-panel'
}

export interface StoredExtensionDisplayMode {
  sidePanelMode: boolean
}

export function readStoredExtensionDisplayMode(value: unknown): boolean | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const sidePanelMode = (value as Record<string, unknown>).sidePanelMode
  return typeof sidePanelMode === 'boolean' ? sidePanelMode : null
}
