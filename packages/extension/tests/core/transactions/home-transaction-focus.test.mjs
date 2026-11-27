import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearHomeTransactionFocus,
  homeActivityPath,
  resolveHomeAssetDomain,
  resolveHomeDefaultTab,
  resolveWalletEntryRoute
} from '../../../src/popup/services/home-navigation.ts'
import {
  readShieldFundsOrigin,
  resolveShieldFundsOrigin,
  shieldFundsPath,
  shieldFundsResultExitPath
} from '../../../src/popup/services/shield-funds-route.ts'

test('one-time Activity focus removes only transactionId from the current history entry', () => {
  assert.equal(clearHomeTransactionFocus('?tab=activity&transactionId=tx-1'), '/?tab=activity')
  assert.equal(clearHomeTransactionFocus('?transactionId=tx-1'), '/')
  assert.equal(clearHomeTransactionFocus('?tab=activity'), null)
})

test('opening Activity for a result keeps its balance domain after clearing focus', () => {
  const transactionId = 'quote:tx/1+2'
  for (const domain of ['public', 'private', 'shield']) {
    const path = homeActivityPath(domain, transactionId)
    const search = path.slice(1)
    assert.equal(resolveWalletEntryRoute(`#${path}`), path)
    assert.equal(resolveHomeDefaultTab(search), 'activity')
    assert.equal(resolveHomeAssetDomain(search), domain)
    assert.equal(new URLSearchParams(search).get('transactionId'), transactionId)
    assert.equal(clearHomeTransactionFocus(search), homeActivityPath(domain))
  }
})

test('Shield results return to their initiating detail only for the same wallet account and network', () => {
  const scope = { network: 'mainnet', walletId: 'wallet-one', accountId: 'account-one' }
  for (const path of [
    '/asset-detail?assetId=eip155%3A1%2Fslip44%3A60&domain=private&mode=private',
    '/shield-provider?provider=near-confidential&mode=private'
  ]) {
    const origin = { ...scope, path }
    const exit = new URLSearchParams(shieldFundsResultExitPath(origin).split('?')[1])
    assert.equal(exit.get('resultExit'), '1')
    assert.equal(resolveShieldFundsOrigin(readShieldFundsOrigin(exit), scope), path)
    const retry = new URLSearchParams(
      shieldFundsPath('shield', 'zec', 'zcash-shield', origin).split('?')[1]
    )
    assert.equal(retry.get('resultExit'), null)
    assert.equal(resolveShieldFundsOrigin(readShieldFundsOrigin(retry), scope), path)
    assert.equal(resolveShieldFundsOrigin(origin, { ...scope, accountId: 'account-two' }), null)
    assert.equal(resolveShieldFundsOrigin(origin, { ...scope, walletId: 'wallet-two' }), null)
    assert.equal(resolveShieldFundsOrigin(origin, { ...scope, network: 'testnet' }), null)
  }
  assert.equal(resolveShieldFundsOrigin(undefined, scope), null)
  assert.equal(
    resolveShieldFundsOrigin({ ...scope, path: '//external.test/asset-detail' }, scope),
    null
  )
})
