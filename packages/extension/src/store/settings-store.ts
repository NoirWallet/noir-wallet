import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { WALLET_CONFIG, type AutoLockMs } from '@/config/wallet'
import { DEFAULT_FEE_TIER, type FeeTier } from '@/config/fee'
import { createChromeStorageAdapter } from '@/lib/chrome-storage-adapter'
import { applyLendingSdkEnv } from '@/core/services/lending-sdk-init'
import { setNearRpcUrl } from '@/core/services/lending-service'
import {
  DEFAULT_BLOCK_EXPLORER_PREFERENCES,
  setActiveBlockExplorerPreferences,
  type BlockExplorerChain,
  type BlockExplorerId,
  type BlockExplorerPreferences
} from '@/config/block-explorers'
import {
  DEFAULT_RPC_ENDPOINT_MODES,
  DEFAULT_RPC_ENDPOINT_PREFERENCES,
  migrateRpcEndpointDefaults,
  parseRpcEndpointModes,
  setActiveCustomRpcEndpoints,
  setActiveRpcEndpointModes,
  setActiveRpcEndpointPreferences,
  type RpcEndpointChain,
  type RpcEndpointId,
  type RpcEndpointModes,
  type RpcEndpointPreferences
} from '@/config/rpc-endpoints'
import {
  EMPTY_CUSTOM_RPC_ENDPOINTS,
  parseCustomRpcEndpoints,
  type CustomRpcEndpoints
} from '@/config/custom-rpc'
import { SETTINGS_STORAGE_KEY } from '@/config/storage-keys'

export const AUTO_LOCK_OPTIONS = WALLET_CONFIG.SECURITY.AUTO_LOCK.OPTIONS

interface SettingsStore {
  autoLockMs: AutoLockMs
  nearRpcUrl: string
  enableDerivedAccounts: boolean
  blockExplorerPreferences: BlockExplorerPreferences
  rpcEndpointPreferences: RpcEndpointPreferences
  rpcEndpointModes: RpcEndpointModes
  customRpcEndpoints: CustomRpcEndpoints
  zeroIndexerDefaultApplied: boolean
  feeTier: FeeTier
  votingIntroSeen: boolean
  sidePanelMode: boolean
  isSidePanelModeLoaded: boolean
  isLoaded: boolean
  setAutoLockMs: (ms: AutoLockMs) => void
  setNearRpcUrl: (url: string) => void
  setEnableDerivedAccounts: (enable: boolean) => void
  setBlockExplorerPreference: (chain: BlockExplorerChain, explorerId: BlockExplorerId) => void
  setRpcEndpointPreference: (chain: RpcEndpointChain, endpointId: RpcEndpointId) => void
  syncRpcEndpointSettings: (
    preferences: RpcEndpointPreferences,
    modes: RpcEndpointModes,
    customRpcEndpoints: CustomRpcEndpoints
  ) => void
  setFeeTier: (tier: FeeTier) => void
  setVotingIntroSeen: (seen: boolean) => void
  setSidePanelMode: (enabled: boolean) => Promise<void>
  syncSidePanelMode: (enabled: boolean) => void
  loadSidePanelMode: () => Promise<void>
  loadSettings: () => Promise<void>
}

export { SETTINGS_STORAGE_KEY }

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      autoLockMs: WALLET_CONFIG.SECURITY.AUTO_LOCK.DEFAULT_MS,
      nearRpcUrl: '',
      enableDerivedAccounts: false,
      blockExplorerPreferences: DEFAULT_BLOCK_EXPLORER_PREFERENCES,
      rpcEndpointPreferences: DEFAULT_RPC_ENDPOINT_PREFERENCES,
      rpcEndpointModes: DEFAULT_RPC_ENDPOINT_MODES,
      customRpcEndpoints: EMPTY_CUSTOM_RPC_ENDPOINTS,
      zeroIndexerDefaultApplied: true,
      feeTier: DEFAULT_FEE_TIER,
      votingIntroSeen: false,
      sidePanelMode: false,
      isSidePanelModeLoaded: false,
      isLoaded: false,

      setAutoLockMs: ms => {
        set({ autoLockMs: ms })
      },

      setNearRpcUrl: url => {
        set({ nearRpcUrl: url })
        if (url) {
          setNearRpcUrl(url)
        }
      },

      setEnableDerivedAccounts: enable => {
        set({ enableDerivedAccounts: enable })
      },

      setFeeTier: tier => {
        set({ feeTier: tier })
      },

      setVotingIntroSeen: seen => {
        set({ votingIntroSeen: seen })
      },

      setSidePanelMode: async enabled => {
        const response = await chrome.runtime.sendMessage({
          type: 'SET_EXTENSION_DISPLAY_MODE',
          sidePanelMode: enabled
        })
        if (!response?.success) {
          throw new Error(response?.error || 'Failed to change wallet display mode')
        }
        if (typeof response.sidePanelMode !== 'boolean') {
          throw new Error('Background returned an invalid wallet display mode')
        }
        set({ sidePanelMode: response.sidePanelMode, isSidePanelModeLoaded: true })
      },

      syncSidePanelMode: enabled => {
        set({ sidePanelMode: enabled, isSidePanelModeLoaded: true })
      },

      loadSidePanelMode: async () => {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_EXTENSION_DISPLAY_MODE'
        })
        if (!response?.success || typeof response.sidePanelMode !== 'boolean') {
          throw new Error(response?.error || 'Failed to read wallet display mode')
        }
        set({ sidePanelMode: response.sidePanelMode, isSidePanelModeLoaded: true })
      },

      setBlockExplorerPreference: (chain, explorerId) => {
        const blockExplorerPreferences = {
          ...get().blockExplorerPreferences,
          [chain]: explorerId
        }
        set({ blockExplorerPreferences })
        setActiveBlockExplorerPreferences(blockExplorerPreferences)
      },

      setRpcEndpointPreference: (chain, endpointId) => {
        const rpcEndpointPreferences = {
          ...get().rpcEndpointPreferences,
          [chain]: endpointId
        }
        const rpcEndpointModes = { ...get().rpcEndpointModes, [chain]: 'fixed' as const }
        set({ rpcEndpointPreferences, rpcEndpointModes, zeroIndexerDefaultApplied: true })
        setActiveRpcEndpointPreferences(rpcEndpointPreferences)
        setActiveRpcEndpointModes(rpcEndpointModes)
      },

      syncRpcEndpointSettings: (
        rpcEndpointPreferences,
        rpcEndpointModesValue,
        customRpcEndpointsValue
      ) => {
        const rpcEndpointModes = parseRpcEndpointModes(rpcEndpointModesValue)
        const customRpcEndpoints = parseCustomRpcEndpoints(customRpcEndpointsValue)
        set({
          rpcEndpointPreferences,
          rpcEndpointModes,
          customRpcEndpoints,
          zeroIndexerDefaultApplied: true
        })
        setActiveCustomRpcEndpoints(customRpcEndpoints)
        setActiveRpcEndpointPreferences(rpcEndpointPreferences)
        setActiveRpcEndpointModes(rpcEndpointModes)
      },

      loadSettings: async () => {
        if (get().isLoaded) return
        const {
          nearRpcUrl,
          blockExplorerPreferences,
          rpcEndpointPreferences,
          rpcEndpointModes,
          customRpcEndpoints
        } = get()
        if (nearRpcUrl) {
          setNearRpcUrl(nearRpcUrl)
        }
        applyLendingSdkEnv('prd')
        setActiveBlockExplorerPreferences(blockExplorerPreferences)
        setActiveCustomRpcEndpoints(customRpcEndpoints)
        setActiveRpcEndpointPreferences(rpcEndpointPreferences)
        setActiveRpcEndpointModes(rpcEndpointModes)
        set({ isLoaded: true })
      }
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createChromeStorageAdapter('local') as any,
      onRehydrateStorage: () => state => {
        setActiveBlockExplorerPreferences(state?.blockExplorerPreferences)
        setActiveCustomRpcEndpoints(state?.customRpcEndpoints)
        setActiveRpcEndpointPreferences(state?.rpcEndpointPreferences)
        setActiveRpcEndpointModes(state?.rpcEndpointModes)
      },
      merge: (persistedState, currentState) => {
        if (typeof persistedState !== 'object' || persistedState === null) return currentState

        const persistedSettings = { ...persistedState } as Partial<SettingsStore>
        delete persistedSettings.sidePanelMode
        delete persistedSettings.isSidePanelModeLoaded
        persistedSettings.customRpcEndpoints = parseCustomRpcEndpoints(
          persistedSettings.customRpcEndpoints
        )
        persistedSettings.rpcEndpointModes = parseRpcEndpointModes(
          persistedSettings.rpcEndpointModes
        )
        const migrated = migrateRpcEndpointDefaults(
          persistedSettings.rpcEndpointPreferences,
          persistedSettings.rpcEndpointModes,
          persistedSettings.zeroIndexerDefaultApplied
        )
        persistedSettings.rpcEndpointPreferences = migrated.preferences
        persistedSettings.rpcEndpointModes = migrated.modes
        persistedSettings.zeroIndexerDefaultApplied = true
        return { ...currentState, ...persistedSettings }
      },
      partialize: state => ({
        autoLockMs: state.autoLockMs,
        nearRpcUrl: state.nearRpcUrl,
        enableDerivedAccounts: state.enableDerivedAccounts,
        blockExplorerPreferences: state.blockExplorerPreferences,
        rpcEndpointPreferences: state.rpcEndpointPreferences,
        rpcEndpointModes: state.rpcEndpointModes,
        customRpcEndpoints: state.customRpcEndpoints,
        zeroIndexerDefaultApplied: state.zeroIndexerDefaultApplied,
        feeTier: state.feeTier,
        votingIntroSeen: state.votingIntroSeen
      })
    }
  )
)
