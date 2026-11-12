import { test } from 'node:test'
import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLazyDkgPort, type DkgPort } from '../../../src/core/multisig/dkg-port'
import { isVaultRpcBlocked } from '../../../src/core/multisig/multisig-runtime-policy'

const extensionDir = fileURLToPath(new URL('../../../', import.meta.url))

function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(extensionDir, relativePath), 'utf8')
}

const VAULT_METHODS = [
  'vault.dkg.open',
  'vault.dkg.acceptRound1',
  'vault.dkg.acceptRound2',
  'vault.dkg.close'
] as const

test.describe('multisig dkg wiring', () => {
  test('blocks vault RPC only while the multisig UI is off', () => {
    expect(isVaultRpcBlocked('vault.dkg.open', false)).toBe(true)
    expect(isVaultRpcBlocked('vault.anything', false)).toBe(true)
    expect(isVaultRpcBlocked('vault.dkg.open', true)).toBe(false)
    expect(isVaultRpcBlocked('mnemonic.validate', false)).toBe(false)
  })

  test('a lazy port loads once and retries after a failed load', async () => {
    let loads = 0
    const inner: DkgPort = {
      open: async () => ({ sessionId: 'sid' }),
      acceptRound1: async () => ({ complete: false }),
      acceptRound2: async () => ({ complete: false }),
      close: async () => {}
    }
    const port = createLazyDkgPort(async () => {
      loads += 1
      if (loads === 1) throw new Error('offline')
      return inner
    })
    const open = { participants: 2, threshold: 2, mainnet: true } as const
    await expect(port.open(open)).rejects.toThrow('offline')
    expect(await port.open(open)).toEqual({ sessionId: 'sid' })
    await port.close({ sessionId: 'sid' })
    expect(await port.acceptRound1({ sessionId: 'sid', senderSlot: 1, envelope: 'AA' })).toEqual({
      complete: false
    })
    expect(loads).toBe(2)
  })

  test('the Worker, client and Background are wired to the vault handler', async () => {
    const [workerSource, clientSource, backgroundSource] = await Promise.all([
      readSource('src/core/worker/zcash.worker.ts'),
      readSource('src/core/worker/client.ts'),
      readSource('src/background/index.ts')
    ])
    expect(workerSource).toContain('createVaultDkgRpcHandler(')
    for (const method of VAULT_METHODS) {
      expect(workerSource).toContain(`case '${method}'`)
      expect(clientSource).toContain(`'${method}': LIGHT`)
    }
    expect(backgroundSource).toContain('isVaultRpcBlocked(rpcMessage.method)')
  })
})
