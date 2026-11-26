import { test } from 'node:test'
import { expect } from '@playwright/test'
import { createInitialProductChainRegistry } from '../../../src/core/chains/registry/index.ts'
import { getHomeAccountCapabilities } from '../../../src/popup/services/home-account-capabilities.ts'

import {
  homeAssetDomainPath,
  legacyShieldHomePath,
  resolveLegacyShieldFundsPath,
  resolveHomeDefaultTab
} from '../../../src/popup/services/home-navigation.ts'

test.describe('Home navigation', () => {
  test('opens Activity only for the explicit internal tab target', () => {
    expect(resolveHomeDefaultTab('?tab=activity')).toBe('activity')
    expect(resolveHomeDefaultTab('')).toBe('assets')
    expect(resolveHomeDefaultTab('?tab=lending')).toBe('assets')
    expect(resolveHomeDefaultTab('?tab=activity&tab=assets')).toBe('activity')
    expect(resolveHomeDefaultTab('?tab=shield')).toBe('assets')
  })

  test('opens legacy Shield links in the corresponding current view', () => {
    expect(legacyShieldHomePath('?tab=shield')).toBe('/?domain=shield&tab=providers')
    expect(resolveLegacyShieldFundsPath('?action=send')).toBe('/send?sourceMode=shield')
    expect(legacyShieldHomePath('?tab=shield&action=receive')).toBe('/receive?mode=shield')
    expect(resolveLegacyShieldFundsPath('?action=swap')).toBe('/swap?balanceDomain=shield')
    expect(legacyShieldHomePath('?domain=shield&mode=private')).toBeNull()
    expect(legacyShieldHomePath('?tab=activity')).toBeNull()
    expect(homeAssetDomainPath('', 'shield')).toBe('/?domain=shield')
  })

  test('gates hardware Home actions by the active chain and the supported funding source', () => {
    const chains = createInitialProductChainRegistry('mainnet').list()
    const zcash = chains.find(chain => chain.family === 'zcash')
    const evm = chains.find(chain => chain.family === 'evm')
    const capabilitiesFor = (chains, vendor, enabledFlags = ['chain.zcash', 'chain.evm']) =>
      getHomeAccountCapabilities({
        account: {
          walletSource: {
            kind: 'hardware',
            hardware: { vendor, capabilities: ['zcash', 'evm'] }
          },
          networks: chains.map(chain => ({ chain, addresses: [] }))
        },
        network: 'mainnet',
        enabledFlags
      })

    const evmHome = capabilitiesFor([evm], 'keystone')
    expect(evmHome).toMatchObject({ hasZcash: false, canSend: true, canReceive: true })
    expect(capabilitiesFor([evm], 'ledger')).toEqual(evmHome)
    expect(capabilitiesFor([zcash], 'keystone')).toMatchObject({
      hasZcash: true,
      canSend: true,
      canReceive: true,
      sendFromShieldedZcash: true,
      canShieldFromHome: false,
      canSwapFromPublic: false
    })
    expect(capabilitiesFor([zcash], 'ledger')).toMatchObject({
      hasZcash: true,
      sendFromShieldedZcash: false,
      canShieldFromHome: true
    })
    expect(capabilitiesFor([zcash, evm], 'ledger', ['chain.evm'])).toEqual(evmHome)
  })
})
