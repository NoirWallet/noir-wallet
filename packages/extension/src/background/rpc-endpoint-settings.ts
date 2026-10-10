import {
  AUTOMATIC_RPC_ENDPOINT_ID,
  ensureRpcEndpointPreferencesLoaded,
  getActiveRpcEndpointMode,
  getActiveRpcEndpointOption,
  getRpcEndpointOptions,
  isRpcEndpointUrlConfigured,
  readPersistedRpcEndpointSettings,
  writePersistedRpcEndpointSettings,
  type PersistedRpcEndpointSettings,
  type RpcEndpointChain,
  type RpcEndpointOption
} from '@/config/rpc-endpoints'
import { createCustomRpcEndpoint, isCustomRpcEndpointId } from '@/config/custom-rpc'
import { verifyZcashRpcEndpoint } from '@/config/rpc-registry-client'
import { DEFAULT_NETWORK } from '@/config/networks'
import { getRpcFailoverState } from '@/config/rpc-failover'

export interface RpcEndpointSettingsMutationResult extends PersistedRpcEndpointSettings {
  selectedEndpointId: string
  latencyMs?: number
  runtimeChanged: boolean
}

export interface RpcEndpointStatus {
  mode: 'auto' | 'fixed'
  selectedEndpointId: string
  activeEndpoint: RpcEndpointOption
}

let mutationQueue: Promise<void> = Promise.resolve()

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.catch(() => {}).then(operation)
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function assertMainnetSettingsAvailable(): void {
  if (DEFAULT_NETWORK !== 'mainnet') {
    throw new Error('Custom RPC endpoints are not available in testnet builds')
  }
}

async function verifyCustomEndpoint(endpoint: { id: string; label: string; url: string }) {
  return verifyZcashRpcEndpoint(endpoint, 'mainnet')
}

function getDefaultManagedEndpoint(chain: RpcEndpointChain): RpcEndpointOption {
  const managed = getRpcEndpointOptions(chain).filter(option => !isCustomRpcEndpointId(option.id))
  const endpoint = managed.find(option => option.id === AUTOMATIC_RPC_ENDPOINT_ID) ?? managed[0]
  if (!endpoint) throw new Error('No managed RPC endpoint is available')
  return endpoint
}

export async function getRpcEndpointStatus(): Promise<RpcEndpointStatus> {
  await ensureRpcEndpointPreferencesLoaded()
  await getRpcFailoverState()
  const activeEndpoint = getActiveRpcEndpointOption('zcash')
  return {
    mode: getActiveRpcEndpointMode('zcash'),
    selectedEndpointId: activeEndpoint.id,
    activeEndpoint
  }
}

export function selectAutomaticRpcEndpoint(
  chain: RpcEndpointChain
): Promise<RpcEndpointSettingsMutationResult> {
  return enqueue(async () => {
    assertMainnetSettingsAvailable()
    if (chain !== 'zcash') throw new Error('Unsupported RPC chain')

    await ensureRpcEndpointPreferencesLoaded()
    const current = await readPersistedRpcEndpointSettings()
    const endpoint = getDefaultManagedEndpoint(chain)
    const runtimeChanged =
      current.modes[chain] !== 'auto' || current.preferences[chain] !== endpoint.id
    const next: PersistedRpcEndpointSettings = {
      ...current,
      modes: { ...current.modes, [chain]: 'auto' },
      preferences: { ...current.preferences, [chain]: endpoint.id }
    }
    await writePersistedRpcEndpointSettings(next)
    return {
      ...next,
      selectedEndpointId: endpoint.id,
      runtimeChanged
    }
  })
}

export function addCustomRpcEndpoint(
  chain: RpcEndpointChain,
  label: unknown,
  url: unknown
): Promise<RpcEndpointSettingsMutationResult> {
  return enqueue(async () => {
    assertMainnetSettingsAvailable()
    if (chain !== 'zcash') throw new Error('Unsupported RPC chain')

    const endpoint = createCustomRpcEndpoint(label, url)
    await ensureRpcEndpointPreferencesLoaded()
    const current = await readPersistedRpcEndpointSettings()
    if (isRpcEndpointUrlConfigured(chain, endpoint.url)) {
      throw new Error('This RPC endpoint is already available')
    }

    const latencyMs = await verifyCustomEndpoint(endpoint)
    const next: PersistedRpcEndpointSettings = {
      preferences: { ...current.preferences, zcash: endpoint.id },
      modes: { ...current.modes, zcash: 'fixed' },
      customRpcEndpoints: {
        zcash: [...current.customRpcEndpoints.zcash, endpoint]
      }
    }
    await writePersistedRpcEndpointSettings(next)
    return {
      ...next,
      selectedEndpointId: endpoint.id,
      latencyMs,
      runtimeChanged: true
    }
  })
}

export function selectRpcEndpoint(
  chain: RpcEndpointChain,
  endpointId: string
): Promise<RpcEndpointSettingsMutationResult> {
  return enqueue(async () => {
    assertMainnetSettingsAvailable()
    if (chain !== 'zcash') throw new Error('Unsupported RPC chain')

    await ensureRpcEndpointPreferencesLoaded()
    const current = await readPersistedRpcEndpointSettings()
    const endpoint = getRpcEndpointOptions(chain).find(option => option.id === endpointId)
    if (!endpoint) throw new Error('RPC endpoint is no longer available')

    const latencyMs = isCustomRpcEndpointId(endpoint.id)
      ? await verifyCustomEndpoint(endpoint)
      : undefined
    const runtimeChanged =
      current.modes[chain] !== 'fixed' || current.preferences[chain] !== endpoint.id
    const next: PersistedRpcEndpointSettings = {
      ...current,
      modes: { ...current.modes, [chain]: 'fixed' },
      preferences: { ...current.preferences, [chain]: endpoint.id }
    }
    await writePersistedRpcEndpointSettings(next)
    return {
      ...next,
      selectedEndpointId: endpoint.id,
      latencyMs,
      runtimeChanged
    }
  })
}

export function removeCustomRpcEndpoint(
  chain: RpcEndpointChain,
  endpointId: string
): Promise<RpcEndpointSettingsMutationResult> {
  return enqueue(async () => {
    assertMainnetSettingsAvailable()
    if (chain !== 'zcash' || !isCustomRpcEndpointId(endpointId)) {
      throw new Error('Only custom RPC endpoints can be removed')
    }

    const current = await readPersistedRpcEndpointSettings()
    if (!current.customRpcEndpoints.zcash.some(endpoint => endpoint.id === endpointId)) {
      throw new Error('Custom RPC endpoint was not found')
    }

    const removingSelectedEndpoint = current.preferences.zcash === endpointId
    const returnToAuto = current.modes.zcash === 'fixed' && removingSelectedEndpoint
    const automaticEndpoint = returnToAuto ? getDefaultManagedEndpoint(chain) : undefined
    const runtimeChanged = returnToAuto
    const next: PersistedRpcEndpointSettings = {
      preferences: {
        ...current.preferences,
        ...(removingSelectedEndpoint
          ? { zcash: automaticEndpoint?.id ?? AUTOMATIC_RPC_ENDPOINT_ID }
          : {})
      },
      modes: {
        ...current.modes,
        ...(returnToAuto ? { zcash: 'auto' as const } : {})
      },
      customRpcEndpoints: {
        zcash: current.customRpcEndpoints.zcash.filter(endpoint => endpoint.id !== endpointId)
      }
    }
    await writePersistedRpcEndpointSettings(next)
    return {
      ...next,
      selectedEndpointId: next.preferences.zcash,
      runtimeChanged
    }
  })
}
