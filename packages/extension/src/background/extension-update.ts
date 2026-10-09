import {
  clearExtensionUpdateState,
  fetchShouldNotifyExtensionUpdate,
  readExtensionUpdateState,
  writeExtensionUpdateState
} from '@/lib/extension-update'

async function handleUpdateAvailable(version: string): Promise<void> {
  const currentVersion = chrome.runtime.getManifest().version
  let shouldNotify: boolean

  try {
    shouldNotify = await fetchShouldNotifyExtensionUpdate(currentVersion, version)
  } catch (error) {
    await clearExtensionUpdateState()
    throw error
  }

  if (!shouldNotify) {
    await clearExtensionUpdateState()
    return
  }

  const currentState = await readExtensionUpdateState()
  if (currentState?.status === 'available' && currentState.version === version) {
    return
  }

  await writeExtensionUpdateState({
    status: 'available',
    version,
    detectedAt: Date.now()
  })
}

function handleInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install' || details.reason === 'update') {
    clearExtensionUpdateState().catch(error => {
      console.warn('[Update] Failed to clear update state after installation:', error)
    })
  }
}

export function initializeExtensionUpdates(): void {
  chrome.runtime.onUpdateAvailable.addListener(details => {
    handleUpdateAvailable(details.version).catch(error => {
      console.warn('[Update] Failed to handle available update:', error)
    })
  })

  chrome.runtime.onInstalled.addListener(handleInstalled)
}
