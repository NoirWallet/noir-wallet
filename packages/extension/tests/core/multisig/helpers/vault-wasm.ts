/**
 * Brings up the extension's real wallet WASM package inside Node, so the multisig tests exercise
 * the vault API rather than a stand-in. Loaded once per process.
 */
import { readFile } from 'node:fs/promises'
import type { DkgPort } from '../../../../src/core/multisig/dkg-port'
import type { VaultWasm } from '../../../../src/core/multisig/dkg-protocol'
import type {
  VaultDkgMethod,
  VaultDkgRpcHandler,
  VaultDkgSchema
} from '../../../../src/core/multisig/dkg-rpc'

type WalletWasmModule = typeof import('../../../../src/lib/wasm-pkg/zcash_wallet_wasm')

const packageDir = new URL('../../../../src/lib/wasm-pkg/', import.meta.url)

let loading: Promise<VaultWasm> | null = null

export function loadVaultWasm(): Promise<VaultWasm> {
  loading ??= (async () => {
    // The package's thread helper touches these Worker globals while it is being imported.
    const host = globalThis as Record<string, unknown>
    host.self ??= globalThis
    host.addEventListener ??= () => {}
    host.removeEventListener ??= () => {}
    const wasm: WalletWasmModule = await import(new URL('zcash_wallet_wasm.js', packageDir).href)
    const binary = await readFile(new URL('zcash_wallet_wasm_bg.wasm', packageDir))
    // No thread pool: the vault API is single-threaded and the tests have no cross-origin isolation.
    wasm.initSync({ module: binary })
    return wasm
  })()
  return loading
}

/**
 * A DkgPort that calls a Worker handler in this process. Every request and response is JSON
 * round-tripped, as it would be across chrome.runtime messaging.
 */
export function createInProcessDkgPort(handler: VaultDkgRpcHandler): DkgPort {
  const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  async function call<M extends VaultDkgMethod>(
    method: M,
    request: VaultDkgSchema[M]['request']
  ): Promise<VaultDkgSchema[M]['response']> {
    return roundTrip(await handler.handle(method, roundTrip(request)))
  }
  return {
    open: request => call('vault.dkg.open', request),
    acceptRound1: request => call('vault.dkg.acceptRound1', request),
    acceptRound2: request => call('vault.dkg.acceptRound2', request),
    close: async request => {
      await call('vault.dkg.close', request)
    }
  }
}
