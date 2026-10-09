import {
  fetchRpcRegistry,
  parseRpcRegistryDocument,
  selectPreferredRpcEndpoint,
  type RpcProbeFunction
} from './rpc-registry-client'
import {
  EMPTY_CUSTOM_RPC_ENDPOINTS,
  isCustomRpcEndpointId,
  parseCustomRpcEndpoints,
  type CustomRpcEndpoints
} from './custom-rpc'

export type RpcEndpointChain = 'zcash'
export type ZcashRpcEndpointId = string
export type RpcEndpointId = ZcashRpcEndpointId

export interface RpcEndpointOption {
  id: RpcEndpointId
  label: string
  url: string
}

export interface RpcEndpointGroup {
  chain: RpcEndpointChain
  label: string
  iconChain: string
  options: RpcEndpointOption[]
}

export type RpcEndpointPreferences = Record<RpcEndpointChain, RpcEndpointId>
export type RpcEndpointMode = 'auto' | 'fixed'
export type RpcEndpointModes = Record<RpcEndpointChain, RpcEndpointMode>

export const DEFAULT_RPC_ENDPOINT_PREFERENCES: RpcEndpointPreferences = {
  zcash: 'deltarpc'
}

export const DEFAULT_RPC_ENDPOINT_MODES: RpcEndpointModes = {
  zcash: 'auto'
}

// Offline fallback only. Managed endpoint additions and removals belong in the
// remote registry so future changes do not require an extension release.
export const RPC_ENDPOINT_GROUPS: RpcEndpointGroup[] = [
  {
    chain: 'zcash',
    label: 'Zcash',
    iconChain: 'zec',
    options: [
      {
        id: 'deltarpc',
        label: 'DeltaRPC',
        url: 'https://zcash-wallet-grpc-self.deltarpc.com'
      },
      {
        id: 'deltarpc-web',
        label: 'DeltaRPC Singapore Proxy',
        url: 'https://zcashwebrpc.deltarpc.com'
      },
      {
        id: 'deltarpc-web-1',
        label: 'DeltaRPC Singapore Proxy 1',
        url: 'https://zcashwebrpc1.deltarpc.com'
      },
      {
        id: 'deltarpc-web-sg',
        label: 'DeltaRPC Singapore',
        url: 'https://zcashwebrpcsg.deltarpc.com'
      },
      {
        id: 'deltarpc-web-us',
        label: 'DeltaRPC United States',
        url: 'https://zcashwebrpcus.deltarpc.com'
      },
      {
        id: 'chainsafe',
        label: 'ChainSafe',
        url: 'https://zcash-mainnet.chainsafe.dev'
      }
    ]
  }
]

let managedRpcEndpointGroups = cloneRpcEndpointGroups(RPC_ENDPOINT_GROUPS)
let activeCustomRpcEndpoints: CustomRpcEndpoints = { ...EMPTY_CUSTOM_RPC_ENDPOINTS }
let rpcEndpointOptionsByChain = buildOptionsByChain(managedRpcEndpointGroups)

function buildOptionsByChain(groups: RpcEndpointGroup[]) {
  return groups.reduce(
    (acc, group) => {
      acc[group.chain] = group.options
      return acc
    },
    {} as Record<RpcEndpointChain, RpcEndpointOption[]>
  )
}

function cloneRpcEndpointGroups(groups: RpcEndpointGroup[]): RpcEndpointGroup[] {
  return groups.map(group => ({ ...group, options: group.options.map(option => ({ ...option })) }))
}

function setRpcEndpointGroups(groups: RpcEndpointGroup[]): void {
  managedRpcEndpointGroups = cloneRpcEndpointGroups(groups)
  rebuildRpcEndpointOptions()
}

function rebuildRpcEndpointOptions(): void {
  const managed = buildOptionsByChain(managedRpcEndpointGroups)
  rpcEndpointOptionsByChain = {
    zcash: [...(managed.zcash || []), ...activeCustomRpcEndpoints.zcash]
  }
}

export function setActiveCustomRpcEndpoints(value?: unknown): CustomRpcEndpoints {
  activeCustomRpcEndpoints = parseCustomRpcEndpoints(value)
  rebuildRpcEndpointOptions()
  return getActiveCustomRpcEndpoints()
}

export function getActiveCustomRpcEndpoints(): CustomRpcEndpoints {
  return { zcash: activeCustomRpcEndpoints.zcash.map(endpoint => ({ ...endpoint })) }
}

export function getRpcEndpointGroups(): RpcEndpointGroup[] {
  return managedRpcEndpointGroups.map(group => ({
    ...group,
    options: getRpcEndpointOptions(group.chain)
  }))
}

let activeRpcEndpointPreferences: RpcEndpointPreferences = {
  ...DEFAULT_RPC_ENDPOINT_PREFERENCES
}
let activeRpcEndpointModes: RpcEndpointModes = { ...DEFAULT_RPC_ENDPOINT_MODES }
let activeRpcEndpointOverrides: Partial<Record<RpcEndpointChain, RpcEndpointId>> = {}

export function setActiveRpcEndpointPreferences(preferences?: Partial<RpcEndpointPreferences>) {
  activeRpcEndpointPreferences = {
    ...DEFAULT_RPC_ENDPOINT_PREFERENCES,
    ...preferences
  }
}

export function parseRpcEndpointModes(value: unknown): RpcEndpointModes {
  const modes = value && typeof value === 'object' ? (value as Partial<RpcEndpointModes>) : {}
  return {
    zcash: modes.zcash === 'fixed' ? 'fixed' : 'auto'
  }
}

export function setActiveRpcEndpointModes(modes?: Partial<RpcEndpointModes>): void {
  activeRpcEndpointModes = parseRpcEndpointModes(modes)
}

export function getActiveRpcEndpointModes(): RpcEndpointModes {
  return { ...activeRpcEndpointModes }
}

export function getActiveRpcEndpointMode(chain: RpcEndpointChain): RpcEndpointMode {
  return activeRpcEndpointModes[chain]
}

export function setActiveRpcEndpointOverride(
  chain: RpcEndpointChain,
  endpointId?: RpcEndpointId
): void {
  if (endpointId) {
    activeRpcEndpointOverrides = { ...activeRpcEndpointOverrides, [chain]: endpointId }
    return
  }

  const remaining = { ...activeRpcEndpointOverrides }
  delete remaining[chain]
  activeRpcEndpointOverrides = remaining
}

export function getRpcEndpointOptions(chain: RpcEndpointChain): RpcEndpointOption[] {
  return [...(rpcEndpointOptionsByChain[chain] || [])]
}

export function isRpcEndpointUrlConfigured(chain: RpcEndpointChain, url: string): boolean {
  return (rpcEndpointOptionsByChain[chain] || []).some(endpoint => endpoint.url === url)
}

export async function selectStartupRpcEndpoint(
  chain: RpcEndpointChain,
  persistedEndpointId: RpcEndpointId | undefined,
  probe?: RpcProbeFunction
): Promise<RpcEndpointOption> {
  const options = rpcEndpointOptionsByChain[chain] || []
  const persisted = options.find(endpoint => endpoint.id === persistedEndpointId)
  if (persisted) return persisted

  return selectPreferredRpcEndpoint(
    options.filter(endpoint => !isCustomRpcEndpointId(endpoint.id)),
    undefined,
    probe
  )
}

export function getNextRpcEndpointOption(
  chain: RpcEndpointChain,
  preferredEndpointId: RpcEndpointId,
  activeEndpointId: RpcEndpointId
): RpcEndpointOption | undefined {
  const options = rpcEndpointOptionsByChain[chain] || []
  const preferred = options.find(option => option.id === preferredEndpointId)
  if (!preferred || isCustomRpcEndpointId(preferred.id)) return undefined

  const managedOptions = options.filter(option => !isCustomRpcEndpointId(option.id))
  const failoverOrder = [
    preferred,
    ...managedOptions.filter(option => option.id !== preferredEndpointId)
  ]
  const activeIndex = failoverOrder.findIndex(option => option.id === activeEndpointId)
  return activeIndex >= 0 ? failoverOrder[activeIndex + 1] : undefined
}

export function getPreferredRpcEndpointOption(chain: RpcEndpointChain): RpcEndpointOption {
  const selectedId = activeRpcEndpointPreferences[chain] || DEFAULT_RPC_ENDPOINT_PREFERENCES[chain]
  const options = rpcEndpointOptionsByChain[chain] || []
  const selectedOption = options.find(option => option.id === selectedId)
  const defaultOption = options.find(
    option => option.id === DEFAULT_RPC_ENDPOINT_PREFERENCES[chain]
  )

  const resolved = selectedOption || defaultOption || options[0]
  if (!resolved) throw new Error(`No RPC endpoints configured for ${chain}`)
  return resolved
}

export function getActiveRpcEndpointOption(chain: RpcEndpointChain): RpcEndpointOption {
  const preferredOption = getPreferredRpcEndpointOption(chain)
  const selectedId =
    activeRpcEndpointModes[chain] === 'auto'
      ? activeRpcEndpointOverrides[chain] || preferredOption.id
      : preferredOption.id
  const options = rpcEndpointOptionsByChain[chain] || []
  const selectedOption = options.find(option => option.id === selectedId)

  return selectedOption || preferredOption
}

export function getActiveZcashRpcUrl(): string {
  return getActiveRpcEndpointOption('zcash').url
}

const SETTINGS_STORAGE_KEY = 'wallet_settings'
const RPC_REGISTRY_CACHE_KEY = 'rpc_registry_cache_v1'

type ManagedRpcSource = 'remote' | 'cache' | 'local'

interface StoredRpcPreferences {
  raw: unknown
  parsed: Record<string, unknown> | null
  preferences?: Partial<RpcEndpointPreferences>
  modes: RpcEndpointModes
  customRpcEndpoints: CustomRpcEndpoints
}

function parseStoredSettings(raw: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function readStoredRpcPreferences(): Promise<StoredRpcPreferences> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  const raw = stored[SETTINGS_STORAGE_KEY as keyof typeof stored]
  const parsed = parseStoredSettings(raw)
  const state =
    parsed?.state && typeof parsed.state === 'object'
      ? (parsed.state as Record<string, unknown>)
      : undefined
  const preferences =
    state?.rpcEndpointPreferences && typeof state.rpcEndpointPreferences === 'object'
      ? (state.rpcEndpointPreferences as Partial<RpcEndpointPreferences>)
      : undefined
  return {
    raw,
    parsed,
    preferences,
    modes: parseRpcEndpointModes(state?.rpcEndpointModes),
    customRpcEndpoints: parseCustomRpcEndpoints(state?.customRpcEndpoints)
  }
}

function applyAvailableRpcEndpointSettings(stored: StoredRpcPreferences): RpcEndpointPreferences {
  setActiveCustomRpcEndpoints(stored.customRpcEndpoints)
  const options = getRpcEndpointOptions('zcash')
  const persistedOption = options.find(option => option.id === stored.preferences?.zcash)
  const fallbackOption =
    options.find(option => option.id === DEFAULT_RPC_ENDPOINT_PREFERENCES.zcash) || options[0]
  const preferences: RpcEndpointPreferences = {
    ...DEFAULT_RPC_ENDPOINT_PREFERENCES,
    ...stored.preferences,
    zcash: persistedOption?.id || fallbackOption?.id || DEFAULT_RPC_ENDPOINT_PREFERENCES.zcash
  }
  const modes: RpcEndpointModes = {
    ...stored.modes,
    zcash: stored.modes.zcash === 'fixed' && persistedOption ? 'fixed' : 'auto'
  }
  setActiveRpcEndpointPreferences(preferences)
  setActiveRpcEndpointModes(modes)
  return preferences
}

async function persistRpcEndpointSettings(
  stored: StoredRpcPreferences,
  preferences: RpcEndpointPreferences,
  modes: RpcEndpointModes,
  customRpcEndpoints: CustomRpcEndpoints
): Promise<void> {
  const parsed = stored.parsed ?? { state: {}, version: 0 }
  const state =
    parsed.state && typeof parsed.state === 'object'
      ? (parsed.state as Record<string, unknown>)
      : {}
  const next = {
    ...parsed,
    state: {
      ...state,
      rpcEndpointPreferences: preferences,
      rpcEndpointModes: modes,
      customRpcEndpoints
    }
  }
  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: typeof stored.raw === 'string' ? JSON.stringify(next) : next
  })
}

async function loadRegistryGroups(): Promise<ManagedRpcSource> {
  let registry = null
  let source: ManagedRpcSource = 'remote'
  try {
    registry = await fetchRpcRegistry()
    await chrome.storage.local.set({ [RPC_REGISTRY_CACHE_KEY]: registry }).catch(() => {})
  } catch {
    const cached: Record<string, unknown> = await chrome.storage.local
      .get(RPC_REGISTRY_CACHE_KEY)
      .catch(() => ({}))
    registry = parseRpcRegistryDocument(cached[RPC_REGISTRY_CACHE_KEY])
    source = 'cache'
  }

  const zcash = registry?.chains.find(
    chain => chain.chain === 'zcash' && chain.network === 'mainnet'
  )
  if (!zcash) {
    setRpcEndpointGroups(RPC_ENDPOINT_GROUPS)
    return 'local'
  }

  setRpcEndpointGroups([
    {
      chain: 'zcash',
      label: zcash.label,
      iconChain: zcash.iconChain,
      options: zcash.endpoints
    }
  ])
  return source
}

/**
 * Reads persisted RPC endpoint preferences directly from chrome.storage,
 * bypassing zustand rehydration timing. Safe to call before stores hydrate.
 */
export async function syncActiveRpcEndpointPreferencesFromStorage(): Promise<RpcEndpointPreferences> {
  try {
    const stored = await readStoredRpcPreferences()
    return applyAvailableRpcEndpointSettings(stored)
  } catch {
    setActiveCustomRpcEndpoints()
    setActiveRpcEndpointPreferences()
    setActiveRpcEndpointModes()
  }
  return { ...activeRpcEndpointPreferences }
}

let loadPromise: Promise<RpcEndpointPreferences> | null = null

/**
 * Ensures persisted preferences have been read once before resolving RPC URLs.
 * Await this before creating wallet cores so cold-started contexts (e.g.
 * background service worker) don't fall back to the default endpoint.
 */
export function ensureRpcEndpointPreferencesLoaded(): Promise<RpcEndpointPreferences> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve({ ...activeRpcEndpointPreferences })
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const stored = await readStoredRpcPreferences()
      setActiveCustomRpcEndpoints(stored.customRpcEndpoints)
      const managedSource = await loadRegistryGroups()

      const configuredOptions = getRpcEndpointOptions('zcash')
      const persistedOption = configuredOptions.find(
        option => option.id === stored.preferences?.zcash
      )
      const mode = stored.modes.zcash === 'fixed' && persistedOption ? 'fixed' : 'auto'
      const persistedEndpointId =
        mode === 'fixed' || (persistedOption && !isCustomRpcEndpointId(persistedOption.id))
          ? persistedOption?.id
          : undefined
      const selected = await selectStartupRpcEndpoint('zcash', persistedEndpointId)
      const preferences = {
        ...DEFAULT_RPC_ENDPOINT_PREFERENCES,
        ...stored.preferences,
        zcash: selected.id
      }
      const modes: RpcEndpointModes = { ...stored.modes, zcash: mode }
      setActiveRpcEndpointPreferences(preferences)
      setActiveRpcEndpointModes(modes)

      if (
        managedSource !== 'local' &&
        (stored.preferences?.zcash !== selected.id || stored.modes.zcash !== mode)
      ) {
        await persistRpcEndpointSettings(
          stored,
          preferences,
          modes,
          stored.customRpcEndpoints
        ).catch(() => {})
      }
      return { ...preferences }
    })().catch(() => syncActiveRpcEndpointPreferencesFromStorage())
  }
  return loadPromise
}

// Kick off the initial read in any chrome context (popup/background/offscreen).
// Guarded because this module is also reachable from the Web Worker bundle
// where chrome APIs are unavailable.
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  syncActiveRpcEndpointPreferencesFromStorage().catch(() => {})

  // Keep every extension context in sync when the preference changes elsewhere
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    const change = changes[SETTINGS_STORAGE_KEY]
    if (!change) return
    try {
      const raw = change.newValue
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      applyAvailableRpcEndpointSettings({
        raw,
        parsed,
        preferences: parsed?.state?.rpcEndpointPreferences,
        modes: parseRpcEndpointModes(parsed?.state?.rpcEndpointModes),
        customRpcEndpoints: parseCustomRpcEndpoints(parsed?.state?.customRpcEndpoints)
      })
    } catch {
      /* keep current preferences */
    }
  })
}

export interface PersistedRpcEndpointSettings {
  preferences: RpcEndpointPreferences
  modes: RpcEndpointModes
  customRpcEndpoints: CustomRpcEndpoints
}

export async function readPersistedRpcEndpointSettings(): Promise<PersistedRpcEndpointSettings> {
  const stored = await readStoredRpcPreferences()
  return {
    preferences: { ...DEFAULT_RPC_ENDPOINT_PREFERENCES, ...stored.preferences },
    modes: stored.modes,
    customRpcEndpoints: stored.customRpcEndpoints
  }
}

export async function writePersistedRpcEndpointSettings(
  settings: PersistedRpcEndpointSettings
): Promise<void> {
  const stored = await readStoredRpcPreferences()
  const customRpcEndpoints = parseCustomRpcEndpoints(settings.customRpcEndpoints)
  const modes = parseRpcEndpointModes(settings.modes)
  await persistRpcEndpointSettings(stored, settings.preferences, modes, customRpcEndpoints)
  setActiveCustomRpcEndpoints(customRpcEndpoints)
  setActiveRpcEndpointPreferences(settings.preferences)
  setActiveRpcEndpointModes(modes)
}
