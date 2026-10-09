import { test as it } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const describe = it.describe

const configSource = readFileSync(new URL('../src/config/extension.ts', import.meta.url), 'utf-8')
const configModule = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(configSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { module: configModule, exports: configModule.exports }
)

const { shouldAutoConnectDApp, ZKNOIR_LENDING_URL } = configModule.exports
const handlerSource = readFileSync(
  new URL('../src/background/dapp-handler.ts', import.meta.url),
  'utf-8'
)
const homeSource = readFileSync(new URL('../src/popup/pages/Home.tsx', import.meta.url), 'utf-8')
const appSource = readFileSync(new URL('../src/popup/App.tsx', import.meta.url), 'utf-8')

describe('zkNoir application integration', () => {
  it('auto-connects only the exact first-party application origin', () => {
    assert.equal(shouldAutoConnectDApp('https://app.zknoir.com'), true)
    assert.equal(shouldAutoConnectDApp('http://app.zknoir.com'), false)
    assert.equal(shouldAutoConnectDApp('https://evil.app.zknoir.com'), false)
    assert.equal(shouldAutoConnectDApp('https://app.zknoir.com.evil.example'), false)
    assert.equal(shouldAutoConnectDApp('https://app.zknoir.com/lending'), false)
  })

  it('synchronizes every wallet account without bypassing action approvals', () => {
    assert.match(
      handlerSource,
      /private async authorizeAllWalletAccounts[\s\S]*?this\.buildAllWalletAccounts\(\)/
    )
    assert.match(
      handlerSource,
      /private async getAccounts[\s\S]*?shouldAutoConnectDApp\(origin\)[\s\S]*?authorizeAllWalletAccounts\(origin\)/
    )
    assert.match(
      handlerSource,
      /private async requestAccounts[\s\S]*?shouldAutoConnectDApp\(origin\)[\s\S]*?authorizeAllWalletAccounts\(origin\)/
    )
    assert.match(
      handlerSource,
      /private async ensurePermission[\s\S]*?shouldAutoConnectDApp\(origin\)[\s\S]*?authorizeAllWalletAccounts\(origin\)/
    )
    assert.match(handlerSource, /private async sendTransaction[\s\S]*?requestUserApprovalWithId/)
    assert.match(
      handlerSource,
      /private async signMessage[\s\S]*?requestUserApproval\([\s\S]*?origin,[\s\S]*?'signMessage'/
    )
    assert.match(
      handlerSource,
      /private async shieldFunds[\s\S]*?requestUserApprovalWithId\([\s\S]*?origin,[\s\S]*?'shieldFunds'/
    )
  })

  it('opens Home lending entry points in the zkNoir application and keeps balances', () => {
    assert.equal(ZKNOIR_LENDING_URL, 'https://app.zknoir.com/lending')
    assert.match(homeSource, /chrome\.tabs\.create\(\{ url: ZKNOIR_LENDING_URL \}\)/)
    assert.doesNotMatch(homeSource, /navigate\.navigate\('\/lending'\)/)
    assert.match(homeSource, /safeBig\(walletUsd\)\.plus\(lendingSuppliedUsd\)/)
    assert.match(homeSource, /<TabsContent value="lending"/)
    assert.match(homeSource, /formatPrice\(market\.suppliedUsd/)
    assert.doesNotMatch(appSource, /pages\/lending/)
    assert.doesNotMatch(appSource, /path="\/(?:lending|supply|withdraw)"/)
  })
})
