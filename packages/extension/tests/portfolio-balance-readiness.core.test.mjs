import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPortfolioReadModel, parsePortfolioReadModel } from '../src/core/portfolio/index.ts'
import {
  createAssetRegistry,
  createInitialProductChainRegistry,
  getBundledInitialProductAssetDefinitions,
  getZcashChainId
} from '../src/core/chains/registry/index.ts'
import { readZcashPortfolioSource } from '../src/infrastructure/chains/zcash/zcash-balance-reader.ts'
import { getPortfolioChainBalanceStatus } from '../src/popup/services/portfolio-presentation.ts'

const chainId = getZcashChainId('mainnet')
const chains = createInitialProductChainRegistry('mainnet')
const assets = createAssetRegistry(chains, getBundledInitialProductAssetDefinitions('mainnet'))
const scope = { keyDomainId: 'wallet:balance-loading', accountId: 'account:balance-loading' }
const chainAccount = {
  id: 'chain-account:balance-loading',
  scope: { ...scope, chainId },
  derivation: { scheme: 'zip32-unified', path: "m/32'/133'/0'" },
  identity: { kind: 'account-identifier', value: 'u1example' },
  createdAt: 1000
}

function model({ balance = null, status = 'loading', errorCode, updatedAt = 0 } = {}) {
  const source = readZcashPortfolioSource({
    chainId,
    chainAccount,
    chains,
    assets,
    balance,
    status,
    updatedAt,
    ...(errorCode ? { errorCode } : {})
  })
  const result = buildPortfolioReadModel(scope, [source], chains, assets)
  return parsePortfolioReadModel(JSON.parse(JSON.stringify(result)), chains, assets)
}

test('unknown ZEC balance remains loading across the cached read contract', () => {
  const result = model()
  assert.equal(result.status, 'loading')
  assert.equal(result.assets.length, 0)
  assert.equal(result.chains[0].chain.family, 'zcash')
  assert.equal(getPortfolioChainBalanceStatus(result.chains[0]), 'loading')
})

test('cached balance remains available while refreshing and errors do not erase it', () => {
  const balance = { total: '1.5', shielded: '1.25', transparent: '0.25' }
  const refreshing = model({ balance, updatedAt: 2000 })
  assert.equal(refreshing.assets[0].balance.totalRaw, '150000000')
  assert.equal(refreshing.assets[0].freshness, 'stale')
  assert.equal(getPortfolioChainBalanceStatus(refreshing.chains[0]), 'updating')
  const failed = model({
    balance,
    status: 'error',
    errorCode: 'network-unavailable',
    updatedAt: 2000
  })
  assert.equal(failed.assets[0].balance.totalRaw, '150000000')
  assert.equal(getPortfolioChainBalanceStatus(failed.chains[0]), 'unavailable')
  const unknownFailed = model({ status: 'error', errorCode: 'network-unavailable' })
  assert.equal(unknownFailed.assets.length, 0)
  assert.equal(getPortfolioChainBalanceStatus(unknownFailed.chains[0]), 'unavailable')
})

test('an observed zero balance is ready and remains distinct from an unknown balance', () => {
  const result = model({
    balance: { total: '0', shielded: '0', transparent: '0' },
    status: 'ready',
    updatedAt: 2000
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.assets[0].balance.totalRaw, '0')
  assert.equal(result.assets[0].freshness, 'fresh')
  assert.equal(getPortfolioChainBalanceStatus(result.chains[0]), 'ready')
})
