import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  resolveBitcoinFeatureRuntimePolicy,
  resolveEvmFeatureRuntimePolicy,
  resolveNearFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '../src/core/chains/feature-runtime-policy.ts'

describe('Chain feature runtime policy', () => {
  it('disables new EVM operations without stopping persisted transaction recovery', () => {
    assert.deepEqual(resolveEvmFeatureRuntimePolicy(['chain.zcash']), {
      newOperationsEnabled: false,
      transactionRecoveryEnabled: true
    })
  })

  it('enables new EVM operations only when the release flag is present', () => {
    assert.deepEqual(resolveEvmFeatureRuntimePolicy(['chain.zcash', 'chain.evm']), {
      newOperationsEnabled: true,
      transactionRecoveryEnabled: true
    })
  })

  it('keeps Bitcoin recovery enabled while gating new operations independently', () => {
    assert.deepEqual(resolveBitcoinFeatureRuntimePolicy(['chain.zcash']), {
      newOperationsEnabled: false,
      transactionRecoveryEnabled: true
    })
    assert.deepEqual(resolveBitcoinFeatureRuntimePolicy(['chain.zcash', 'chain.bitcoin']), {
      newOperationsEnabled: true,
      transactionRecoveryEnabled: true
    })
  })

  it('enables Solana operations when the release flag is present', () => {
    assert.deepEqual(resolveSolanaFeatureRuntimePolicy(['chain.zcash']), {
      newOperationsEnabled: false
    })
    assert.deepEqual(resolveSolanaFeatureRuntimePolicy(['chain.zcash', 'chain.solana']), {
      newOperationsEnabled: true
    })
  })

  it('enables NEAR operations when the release flag is present', () => {
    assert.deepEqual(resolveNearFeatureRuntimePolicy(['chain.zcash']), {
      newOperationsEnabled: false
    })
    assert.deepEqual(resolveNearFeatureRuntimePolicy(['chain.zcash', 'chain.near']), {
      newOperationsEnabled: true
    })
  })
})
