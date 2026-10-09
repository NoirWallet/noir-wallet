import { useCallback, useEffect, useState } from 'react'
import {
  EXTENSION_UPDATE_STORAGE_KEY,
  isExtensionUpdateState,
  readExtensionUpdateState,
  type ExtensionUpdateState
} from '@/lib/extension-update'

export function useExtensionUpdate() {
  const [state, setState] = useState<ExtensionUpdateState | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    readExtensionUpdateState()
      .then(updateState => {
        if (active) setState(updateState)
      })
      .catch(error => {
        console.warn('[Update] Failed to read extension update state:', error)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return
      const change = changes[EXTENSION_UPDATE_STORAGE_KEY]
      if (!change) return
      setState(isExtensionUpdateState(change.newValue) ? change.newValue : null)
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChanged)
    }
  }, [])

  const applyUpdate = useCallback(async (version: string): Promise<void> => {
    const updateState = await readExtensionUpdateState()
    if (updateState?.status !== 'available' || updateState.version !== version) {
      throw new Error('The requested extension update is no longer available.')
    }
    chrome.runtime.reload()
  }, [])

  return {
    state,
    isLoading,
    applyUpdate
  }
}
