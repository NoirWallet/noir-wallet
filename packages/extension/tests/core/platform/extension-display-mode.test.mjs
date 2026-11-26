import { test } from 'node:test'
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  applyExtensionDisplayMode,
  enqueueExtensionDisplayModeUpdate,
  persistSidePanelMode,
  readPersistedSidePanelMode,
  readSidePanelMode
} from '../../../src/background/extension-display-mode.ts'
import {
  isSidePanelSurface,
  readStoredExtensionDisplayMode
} from '../../../src/lib/extension-display-mode.ts'
import {
  focusHardwareSignSurface,
  getHardwareSignOriginTab,
  launchHardwareSignSurface
} from '../../../src/lib/hardware-sign-launcher.ts'

test.describe('extension display mode', () => {
  let originalChrome

  test.beforeEach(() => {
    originalChrome = globalThis.chrome
  })

  test.afterEach(() => {
    globalThis.chrome = originalChrome
  })

  test('reads the side panel preference from persisted settings', () => {
    expect(isSidePanelSurface('?surface=side-panel')).toBe(true)
    expect(isSidePanelSurface('?surface=popup')).toBe(false)
    expect(readStoredExtensionDisplayMode({ sidePanelMode: true })).toBe(true)
    expect(readStoredExtensionDisplayMode({ sidePanelMode: false })).toBe(false)
    expect(readStoredExtensionDisplayMode({ sidePanelMode: 'true' })).toBeNull()
    expect(
      readSidePanelMode(
        JSON.stringify({ state: { autoLockMs: 300000, sidePanelMode: true }, version: 0 })
      )
    ).toBe(true)
    expect(readSidePanelMode(JSON.stringify({ state: {}, version: 0 }))).toBe(true)
    expect(readSidePanelMode('{invalid')).toBe(true)
  })

  test('does not let a manifest popup override side panel action clicks', () => {
    const manifestSource = readFileSync(
      new URL('../../../manifest.config.ts', import.meta.url),
      'utf8'
    )
    expect(manifestSource).not.toContain('default_popup')
  })

  test('serializes startup restoration and a later user update', async () => {
    const order = []
    let releaseStartup
    const startupGate = new Promise(resolve => {
      releaseStartup = resolve
    })

    const startup = enqueueExtensionDisplayModeUpdate(async () => {
      order.push('startup:start')
      await startupGate
      order.push('startup:end')
    })
    const userUpdate = enqueueExtensionDisplayModeUpdate(async () => {
      order.push('user:update')
    })

    await Promise.resolve()
    expect(order).toEqual(['startup:start'])
    releaseStartup()
    await Promise.all([startup, userUpdate])
    expect(order).toEqual(['startup:start', 'startup:end', 'user:update'])
  })

  test('configures the toolbar action for side panel mode', async () => {
    const calls = []
    globalThis.chrome = {
      action: {
        setPopup: async options => calls.push(['popup', options])
      },
      sidePanel: {
        setOptions: async options => calls.push(['options', options]),
        setPanelBehavior: async options => calls.push(['behavior', options])
      }
    }

    await applyExtensionDisplayMode(true)

    expect(calls).toEqual([
      ['options', { path: 'index.html?surface=side-panel', enabled: true }],
      ['behavior', { openPanelOnActionClick: true }],
      ['popup', { popup: '' }]
    ])
  })

  test('persists the display mode independently from wallet settings', async () => {
    let writtenValue
    globalThis.chrome = {
      storage: {
        local: {
          set: async value => {
            writtenValue = value
          }
        }
      }
    }

    await persistSidePanelMode(true)

    expect(writtenValue).toEqual({
      extension_display_mode: { sidePanelMode: true }
    })
  })

  test('migrates the display mode from the first beta wallet settings', async () => {
    let writtenValue
    globalThis.chrome = {
      storage: {
        local: {
          get: async () => ({
            wallet_settings: JSON.stringify({
              state: { autoLockMs: 300000, sidePanelMode: true },
              version: 0
            })
          }),
          set: async value => {
            writtenValue = value
          }
        }
      }
    }

    await expect(readPersistedSidePanelMode()).resolves.toBe(true)
    expect(writtenValue).toEqual({
      extension_display_mode: { sidePanelMode: true }
    })
  })

  test('restores popup mode before disabling the side panel', async () => {
    const calls = []
    globalThis.chrome = {
      action: {
        setPopup: async options => calls.push(['popup', options]),
        openPopup: async options => calls.push(['openPopup', options])
      },
      sidePanel: {
        setOptions: async options => calls.push(['options', options]),
        setPanelBehavior: async options => calls.push(['behavior', options])
      }
    }

    await applyExtensionDisplayMode(false)

    expect(calls).toEqual([
      ['popup', { popup: 'index.html' }],
      ['behavior', { openPanelOnActionClick: false }],
      ['options', { path: 'index.html?surface=side-panel', enabled: false }]
    ])
  })

  test('opens hardware signing in an active tab without creating a window', async () => {
    const url = 'chrome-extension://wallet/index.html#/hardware/sign?req=x'
    const calls = []
    let openedWindow = false
    globalThis.chrome = {
      windows: { create: async () => (openedWindow = true) },
      tabs: {
        create: async options => {
          calls.push(options)
          return { id: 8 }
        }
      }
    }

    await expect(launchHardwareSignSurface(url)).resolves.toEqual({ id: 8, url })
    expect(calls).toEqual([{ url, active: true }])
    expect(openedWindow).toBe(false)
  })

  test('leaves the panel tab active and focuses the same signer on demand', async () => {
    const url = 'chrome-extension://wallet/index.html#/hardware/ledger-sign?family=evm&tx=approval'
    const calls = []
    const storedOrigins = {}
    let signerDocumentUrl = url
    globalThis.chrome = {
      storage: {
        session: {
          set: async items => Object.assign(storedOrigins, items),
          get: async key => ({ [key]: storedOrigins[key] })
        }
      },
      runtime: {
        ContextType: { TAB: 'TAB' },
        getContexts: async filter => {
          expect(filter).toEqual({ contextTypes: ['TAB'], tabIds: [8], documentUrls: [url] })
          return filter.documentUrls.includes(signerDocumentUrl)
            ? [{ contextType: 'TAB', tabId: 8, documentUrl: signerDocumentUrl }]
            : []
        }
      },
      tabs: {
        query: async options => {
          expect(options).toEqual({ active: true, currentWindow: true })
          return [{ id: 3, windowId: 17 }]
        },
        create: async options => {
          calls.push(['create', options])
          return { id: 8, windowId: 17 }
        },
        get: async tabId => ({ id: tabId }),
        update: async (tabId, options) => {
          calls.push(['activate', tabId, options])
          return { id: tabId, windowId: 24 }
        }
      },
      windows: {
        update: async (windowId, options) => calls.push(['focus', windowId, options])
      }
    }

    const signer = await launchHardwareSignSurface(url, true)
    expect(calls).toEqual([['create', { url, active: false, windowId: 17, openerTabId: 3 }]])
    await expect(getHardwareSignOriginTab({ id: 8, windowId: 24 }, url)).resolves.toBe(3)
    await expect(
      getHardwareSignOriginTab({ id: 8, windowId: 24 }, `${url}-other`)
    ).resolves.toBeUndefined()

    await focusHardwareSignSurface(signer)
    expect(calls.slice(1)).toEqual([
      ['activate', 8, { active: true }],
      ['focus', 24, { focused: true }]
    ])

    signerDocumentUrl =
      'chrome-extension://wallet/index.html#/hardware/ledger-sign?family=evm&tx=other'
    await expect(focusHardwareSignSurface(signer)).rejects.toThrow('Signing tab is unavailable')
    expect(calls).toHaveLength(3)
  })
})
