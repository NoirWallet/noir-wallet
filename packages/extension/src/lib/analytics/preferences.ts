// Keep the persisted key for existing installations; it now controls only GA.
export const GOOGLE_ANALYTICS_STORAGE_KEY = 'anonymous_analytics_enabled'
export const DEFAULT_GOOGLE_ANALYTICS_ENABLED = true

type GoogleAnalyticsPreferenceListener = (enabled: boolean) => void

const listeners = new Set<GoogleAnalyticsPreferenceListener>()
let cachedEnabled: boolean | undefined
let loadPromise: Promise<boolean> | null = null

function parseStoredPreference(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_GOOGLE_ANALYTICS_ENABLED
}

function updateCachedPreference(enabled: boolean): void {
  if (cachedEnabled === enabled) return
  cachedEnabled = enabled
  for (const listener of listeners) {
    listener(enabled)
  }
}

export async function isGoogleAnalyticsEnabled(): Promise<boolean> {
  if (cachedEnabled !== undefined) return cachedEnabled
  if (loadPromise) return loadPromise

  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_GOOGLE_ANALYTICS_ENABLED
  }

  loadPromise = chrome.storage.local
    .get(GOOGLE_ANALYTICS_STORAGE_KEY)
    .then(result => {
      const enabled = parseStoredPreference(result[GOOGLE_ANALYTICS_STORAGE_KEY])
      updateCachedPreference(enabled)
      return enabled
    })
    .catch(() => DEFAULT_GOOGLE_ANALYTICS_ENABLED)
    .finally(() => {
      loadPromise = null
    })

  return loadPromise
}

export async function setGoogleAnalyticsEnabled(enabled: boolean): Promise<void> {
  const previous = cachedEnabled
  updateCachedPreference(enabled)

  try {
    await chrome.storage.local.set({ [GOOGLE_ANALYTICS_STORAGE_KEY]: enabled })
  } catch (error) {
    cachedEnabled = previous
    if (previous !== undefined) {
      for (const listener of listeners) {
        listener(previous)
      }
    }
    throw error
  }
}

export function onGoogleAnalyticsPreferenceChange(
  listener: GoogleAnalyticsPreferenceListener
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    const change = changes[GOOGLE_ANALYTICS_STORAGE_KEY]
    if (!change) return
    updateCachedPreference(parseStoredPreference(change.newValue))
  })
}
