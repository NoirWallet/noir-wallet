import { useEffect, useState } from 'react'
import type { UserEvmAssetRecord } from '@/core/chains/user-assets'
import { userEvmAssetsClient } from '@/popup/services/user-evm-assets-client'

const EMPTY_USER_EVM_ASSETS: readonly UserEvmAssetRecord[] = Object.freeze([])

export function useUserEvmAssets(): readonly UserEvmAssetRecord[] {
  const [assets, setAssets] = useState<readonly UserEvmAssetRecord[]>(EMPTY_USER_EVM_ASSETS)

  useEffect(() => {
    let cancelled = false
    void userEvmAssetsClient
      .list()
      .then(result => {
        if (!cancelled) setAssets(result)
      })
      .catch(() => {
        if (!cancelled) setAssets(EMPTY_USER_EVM_ASSETS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return assets
}
