import { expect, test } from '@playwright/test'

import { parseChainId } from '../src/core/chains/registry/index.ts'
import {
  BitcoinDiscoveryCoordinator,
  BitcoinGapLimitScanner
} from '../src/infrastructure/chains/bitcoin/index.ts'

const chainId = parseChainId('bip122:000000000019d6689c085ae165831e93').id
const testnetChainId = parseChainId('bip122:000000000933ea01ad0ee984209779ba').id
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
const pointer = {
  schemaVersion: 2,
  generationId: 'metadata:generation:bitcoin-discovery',
  sourceFingerprint: 'a'.repeat(64),
  committedAt: 1_000
}
const chainAccount = {
  id: 'chain-account:bitcoin:discovery',
  scope: {
    keyDomainId: 'key-domain:bitcoin:discovery',
    accountId: 'account:bitcoin:discovery',
    chainId
  },
  derivation: { scheme: 'bip84', path: "m/84'/0'/0'/0/0" },
  identity: { kind: 'account-identifier', value: address },
  createdAt: 1_000
}
const snapshot = {
  manifest: {
    schemaVersion: 2,
    generationId: pointer.generationId,
    status: 'verified',
    sourceFingerprint: pointer.sourceFingerprint,
    createdAt: 1_000,
    verifiedAt: 1_000,
    entityCounts: { keyDomains: 1, accounts: 1, chainAccounts: 1, addresses: 1 },
    activeAccount: {
      keyDomainId: chainAccount.scope.keyDomainId,
      accountId: chainAccount.scope.accountId
    }
  },
  keyDomains: [
    {
      id: chainAccount.scope.keyDomainId,
      credentialRef: 'credential-set:bitcoin:discovery',
      source: { kind: 'software', mnemonicWordCount: 24 },
      displayName: 'Wallet 1',
      createdAt: 1_000
    }
  ],
  accounts: [
    {
      id: chainAccount.scope.accountId,
      keyDomainId: chainAccount.scope.keyDomainId,
      accountIndex: 0,
      displayName: 'Account 1',
      createdAt: 1_000
    }
  ],
  chainAccounts: [chainAccount],
  addresses: []
}

function storage(overrides = {}) {
  return {
    getActivePointer: async () => pointer,
    getSnapshot: async () => snapshot,
    ...overrides
  }
}

function repository() {
  let value = null
  return {
    get: async scope => {
      if (
        JSON.stringify(Object.keys(scope).sort()) !==
        JSON.stringify(['accountIndex', 'chainAccount'])
      ) {
        throw new Error('Discovery repository received fields outside its exact scope')
      }
      return value
    },
    putProgress: async progress => {
      value = Object.freeze({
        chainAccount: progress.chainAccount,
        accountIndex: progress.accountIndex,
        checkpoint: progress.checkpoint,
        observations: Object.freeze([...(value?.observations ?? []), progress.observation]),
        updatedAt: progress.updatedAt
      })
    },
    putRefresh: async refresh => {
      value = Object.freeze({
        chainAccount: refresh.chainAccount,
        accountIndex: refresh.accountIndex,
        checkpoint: refresh.checkpoint,
        observations: refresh.observations,
        updatedAt: refresh.updatedAt
      })
    },
    extendTargets: async extension => {
      if (!value) throw new Error('Target extension requires persisted state')
      value = Object.freeze({
        ...value,
        checkpoint: extension.checkpoint,
        updatedAt: extension.updatedAt
      })
    },
    deleteByAccountScope: async () => {
      const deleted = value ? 1 : 0
      value = null
      return deleted
    }
  }
}

function scanner(onDerive = () => {}) {
  return new BitcoinGapLimitScanner({
    derivation: {
      deriveAddress: async (_keyDomainId, input) => {
        onDerive(input)
        return {
          ...input,
          address,
          addressScheme: 'bitcoin-p2wpkh',
          derivationScheme: 'bip84',
          derivationPath: "m/84'/0'/0'/0/0",
          publicKey: `0x02${'1'.repeat(64)}`
        }
      }
    },
    rpc: {
      assertExpectedChain: async () => {},
      getTipHeight: async () => 900_000,
      getAddressActivity: async () => ({
        confirmedTransactionCount: 0,
        mempoolTransactionCount: 0,
        used: false
      }),
      getAddressUtxos: async () => []
    }
  })
}

function coordinator(overrides = {}) {
  return new BitcoinDiscoveryCoordinator({
    storageRepository: storage(),
    discoveryRepository: repository(),
    scanner: scanner(),
    refresher: {
      refresh: async ({ state }) => ({
        checkpoint: state.checkpoint,
        observations: state.observations
      })
    },
    chainId,
    targets: [{ addressType: 'p2wpkh', change: false }],
    gapLimit: 1,
    maximumAddressesPerTarget: 2,
    now: () => 2_000,
    ...overrides
  })
}

test.describe('Bitcoin active discovery coordinator', () => {
  test('persists a resumable scan and refreshes cached observations without re-deriving', async () => {
    let derives = 0
    const discoveryRepository = repository()
    const instance = coordinator({
      discoveryRepository,
      scanner: scanner(() => {
        derives += 1
      })
    })

    await expect(instance.readCachedActive()).resolves.toBeNull()
    await expect(instance.scanActive()).resolves.toMatchObject({
      accountIndex: 0,
      checkpoint: { cursors: [{ nextAddressIndex: 1, complete: true }] },
      observations: [{ derived: { address } }],
      updatedAt: 2_000
    })
    await expect(instance.readCachedActive()).resolves.toMatchObject({
      observations: [{ derived: { address } }]
    })
    await expect(instance.scanActive()).resolves.toMatchObject({
      observations: [{ derived: { address } }]
    })
    expect(derives).toBe(1)
  })

  test('publishes discovery progress only after the observation is persisted', async () => {
    const discoveryRepository = repository()
    const progress = []
    const instance = coordinator({
      discoveryRepository,
      onProgress: async (context, observation) => {
        const persisted = await discoveryRepository.get({
          chainAccount: context.chainAccount,
          accountIndex: context.accountIndex
        })
        progress.push({ context, observation, persisted })
      }
    })

    await instance.scanActive()

    expect(progress).toHaveLength(1)
    expect(progress[0].context.chainAccount.id).toBe(chainAccount.id)
    expect(progress[0].persisted.observations).toContainEqual(progress[0].observation)
  })

  test('throttles repeated portfolio refreshes but permits a forced spend refresh', async () => {
    let refreshes = 0
    const instance = coordinator({
      refresher: {
        refresh: async ({ state, mode }) => {
          refreshes += 1
          expect(mode).toBe('active')
          return {
            checkpoint: state.checkpoint,
            observations: state.observations
          }
        }
      }
    })

    await instance.scanActive()
    await instance.scanActive()
    expect(refreshes).toBe(0)

    await instance.scanActive({ forceRefresh: true })
    expect(refreshes).toBe(1)
  })

  test('keeps the persisted five-minute Portfolio refresh gate across coordinator recreation', async () => {
    let refreshes = 0
    let currentTime = 2_000
    const discoveryRepository = repository()
    const options = {
      discoveryRepository,
      now: () => currentTime,
      refresher: {
        refresh: async ({ state }) => {
          refreshes += 1
          return { checkpoint: state.checkpoint, observations: state.observations }
        }
      }
    }

    await coordinator(options).scanActive()
    currentTime += 299_999
    await coordinator(options).scanActive()
    expect(refreshes).toBe(0)

    currentTime += 1
    await coordinator(options).scanActive()
    expect(refreshes).toBe(1)
  })

  test('does not retain the in-memory refresh gate after a provider failure', async () => {
    let refreshes = 0
    let fail = true
    let currentTime = 2_000
    const discoveryRepository = repository()
    const instance = coordinator({
      discoveryRepository,
      minimumRefreshIntervalMs: 300_000,
      now: () => currentTime,
      refresher: {
        refresh: async ({ state }) => {
          refreshes += 1
          if (fail) throw new Error('provider unavailable')
          return { checkpoint: state.checkpoint, observations: state.observations }
        }
      }
    })

    await instance.scanActive()
    currentTime += 300_001
    await expect(instance.scanActive({ forceRefresh: true })).rejects.toThrow(
      /provider unavailable/
    )
    fail = false
    await expect(instance.scanActive()).resolves.toMatchObject({
      observations: [{ derived: { address } }]
    })
    expect(refreshes).toBe(2)
  })

  test('deduplicates concurrent scans and discards a result after generation switch', async () => {
    let derives = 0
    let activePointer = pointer
    const instance = coordinator({
      storageRepository: storage({ getActivePointer: async () => activePointer }),
      scanner: scanner(() => {
        derives += 1
        activePointer = { ...pointer, generationId: 'metadata:generation:next' }
      })
    })

    const [first, second] = await Promise.all([instance.scanActive(), instance.scanActive()])
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(derives).toBe(1)
  })

  test('continues gap discovery after refresh finds activity inside the previous unused gap', async () => {
    let derives = 0
    const discoveryRepository = repository()
    const instance = coordinator({
      discoveryRepository,
      scanner: scanner(() => {
        derives += 1
      }),
      refresher: {
        refresh: async ({ state }) => ({
          checkpoint: {
            ...state.checkpoint,
            cursors: [
              {
                ...state.checkpoint.cursors[0],
                consecutiveUnused: 0,
                complete: false
              }
            ]
          },
          observations: state.observations.map(observation => ({
            ...observation,
            activity: {
              confirmedTransactionCount: 1,
              mempoolTransactionCount: 0,
              used: true
            }
          }))
        })
      }
    })

    await instance.scanActive()
    await expect(instance.scanActive({ forceRefresh: true })).resolves.toMatchObject({
      checkpoint: { cursors: [{ nextAddressIndex: 2, complete: true }] },
      observations: [
        { derived: { addressIndex: 0 }, activity: { used: true } },
        { derived: { addressIndex: 1 }, activity: { used: false } }
      ]
    })
    expect(derives).toBe(2)
  })

  test('does not derive or query Bitcoin for hardware firmware without Bitcoin capability', async () => {
    let derives = 0
    const instance = coordinator({
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          keyDomains: snapshot.keyDomains.map(keyDomain => ({
            ...keyDomain,
            source: {
              kind: 'hardware',
              vendor: 'keystone',
              firmwareProfile: 'cypherpunk',
              capabilities: ['zcash']
            }
          }))
        })
      }),
      scanner: scanner(() => {
        derives += 1
      })
    })

    await expect(instance.readCachedActive()).resolves.toBeNull()
    await expect(instance.scanActive()).resolves.toBeNull()
    expect(derives).toBe(0)
  })

  test('discovers only the BIP-84 current address for Bitcoin-capable hardware', async () => {
    const requests = []
    const instance = coordinator({
      targets: undefined,
      maximumAddressesPerTarget: 1,
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          keyDomains: snapshot.keyDomains.map(keyDomain => ({
            ...keyDomain,
            source: {
              kind: 'hardware',
              vendor: 'keystone',
              firmwareProfile: 'multi-coin',
              capabilities: ['bitcoin', 'evm']
            }
          }))
        })
      }),
      scanner: scanner(input => requests.push(input))
    })

    await expect(instance.scanActive()).resolves.toMatchObject({
      checkpoint: {
        cursors: [
          { target: { addressType: 'p2wpkh', change: false }, complete: true }
        ]
      }
    })
    expect(requests).toEqual([
      expect.objectContaining({ addressType: 'p2wpkh', change: false, addressIndex: 0 })
    ])
  })

  test('queries imported private-key address types only when each type becomes active', async () => {
    const requests = []
    const importedChainAccount = {
      ...chainAccount,
      derivation: { scheme: 'imported', path: 'm' }
    }
    const instance = coordinator({
      targets: undefined,
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          keyDomains: snapshot.keyDomains.map(keyDomain => ({
            ...keyDomain,
            source: { kind: 'private-key', chainFamily: 'bip122', bitcoinNetwork: 'mainnet' }
          })),
          chainAccounts: [importedChainAccount]
        })
      }),
      scanner: scanner(input => requests.push(input))
    })

    await expect(instance.scanActive()).resolves.toMatchObject({
      checkpoint: {
        gapLimit: 1,
        maximumAddressesPerTarget: 1,
        cursors: [
          { target: { addressType: 'p2wpkh', change: false }, complete: true },
          { target: { addressType: 'p2tr', change: false }, complete: false },
          { target: { addressType: 'p2pkh', change: false }, complete: false },
          { target: { addressType: 'p2sh-p2wpkh', change: false }, complete: false }
        ]
      }
    })
    expect(requests).toEqual([
      expect.objectContaining({ addressType: 'p2wpkh', change: false, addressIndex: 0 })
    ])

    await expect(instance.scanActive({ addressType: 'p2tr' })).resolves.toMatchObject({
      checkpoint: {
        cursors: [
          { target: { addressType: 'p2wpkh' }, complete: true },
          { target: { addressType: 'p2tr' }, complete: true },
          { target: { addressType: 'p2pkh' }, complete: false },
          { target: { addressType: 'p2sh-p2wpkh' }, complete: false }
        ]
      }
    })
    expect(requests).toEqual([
      expect.objectContaining({ addressType: 'p2wpkh', change: false, addressIndex: 0 }),
      expect.objectContaining({ addressType: 'p2tr', change: false, addressIndex: 0 })
    ])
  })

  test('serializes concurrent scans for different address types and completes both targets', async () => {
    const requests = []
    const instance = coordinator({
      targets: [
        { addressType: 'p2wpkh', change: false },
        { addressType: 'p2tr', change: false }
      ],
      gapLimit: 1,
      maximumAddressesPerTarget: 2,
      scanner: scanner(input => requests.push(input))
    })

    const [nativeSegwit, taproot] = await Promise.all([
      instance.scanActive({ addressType: 'p2wpkh' }),
      instance.scanActive({ addressType: 'p2tr' })
    ])

    expect(
      nativeSegwit.checkpoint.cursors.find(cursor => cursor.target.addressType === 'p2wpkh')
    ).toMatchObject({ complete: true })
    expect(taproot.checkpoint.cursors).toEqual([
      expect.objectContaining({ target: { addressType: 'p2wpkh', change: false }, complete: true }),
      expect.objectContaining({ target: { addressType: 'p2tr', change: false }, complete: true })
    ])
    expect(requests).toEqual([
      expect.objectContaining({ addressType: 'p2wpkh', addressIndex: 0 }),
      expect.objectContaining({ addressType: 'p2tr', addressIndex: 0 })
    ])
  })

  test('fails closed for mismatched metadata and returns null without a Bitcoin account', async () => {
    const mismatch = coordinator({
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          manifest: { ...snapshot.manifest, sourceFingerprint: 'b'.repeat(64) }
        })
      })
    })
    await expect(mismatch.readCachedActive()).rejects.toThrow(/does not match/)

    const missing = coordinator({
      storageRepository: storage({
        getSnapshot: async () => ({ ...snapshot, chainAccounts: [] })
      })
    })
    await expect(missing.readCachedActive()).resolves.toBeNull()

    const wrongPath = coordinator({
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          chainAccounts: [
            { ...chainAccount, derivation: { scheme: 'bip84', path: "m/84'/0'/1'/0/0" } }
          ]
        })
      })
    })
    await expect(wrongPath.readCachedActive()).rejects.toThrow(/bitcoin-mainstream-v1/)
  })

  test('accepts the BIP-84 Bitcoin testnet profile independently from mainnet', async () => {
    const testnetChainAccount = {
      ...chainAccount,
      id: 'chain-account:bitcoin:testnet-discovery',
      scope: { ...chainAccount.scope, chainId: testnetChainId },
      derivation: { scheme: 'bip84', path: "m/84'/1'/0'/0/0" },
      identity: {
        kind: 'account-identifier',
        value: 'tb1qtk89me2ae95dmlp3yfl4q9ynpux8mxjujuf2fr'
      }
    }
    const instance = coordinator({
      chainId: testnetChainId,
      storageRepository: storage({
        getSnapshot: async () => ({ ...snapshot, chainAccounts: [testnetChainAccount] })
      })
    })

    await expect(instance.readCachedActive()).resolves.toBeNull()
  })
})
