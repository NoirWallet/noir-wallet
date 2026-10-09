import { test, expect } from '@playwright/test'
import { ZNS } from 'zcashname-sdk'
import { isZnsName, normalizeZnsName } from '../../src/lib/zns'

const TESTNET_URL = 'https://light.zcash.me/zns-testnet'
const MAINNET_URL = 'https://light.zcash.me/zns-mainnet-test'

test.describe('ZNS SDK Integration', () => {
  test.skip(
    !process.env.LIVE_INTEGRATION,
    'Set LIVE_INTEGRATION=1 to run tests against public ZNS services'
  )

  test('testnet client connects and reports status', async () => {
    const zns = new ZNS({ url: TESTNET_URL })
    const status = await zns.status()

    expect(status).toBeTruthy()
    expect(status.adminPubkey).toBeTruthy()
    expect(typeof status.syncedHeight).toBe('number')
    expect(status.syncedHeight).toBeGreaterThan(0)
    expect(typeof status.registered).toBe('number')
  })

  test('mainnet client connects and reports status', async () => {
    const zns = new ZNS({ url: MAINNET_URL })
    const status = await zns.status()

    expect(status).toBeTruthy()
    expect(status.adminPubkey).toBeTruthy()
    expect(typeof status.syncedHeight).toBe('number')
  })

  test('resolveName aliases return the same address for a known name (testnet)', async () => {
    const zns = new ZNS({ url: TESTNET_URL })

    // "zechariah" is a known testnet registration
    const resolved = await Promise.all(
      ['ZECHARIAH', 'ZECHARIAH.ZEC', 'ZECHARIAH.ZCASH'].map(name => zns.resolveName(name))
    )

    for (const registration of resolved) {
      expect(registration).toBeTruthy()
      expect(registration!.name).toBe('zechariah')
      expect(registration!.address.startsWith('utest1')).toBeTruthy()
      expect(registration!.address).toBe(resolved[0]!.address)
    }
  })

  test('resolveName returns null for non-existent name', async () => {
    const zns = new ZNS({ url: TESTNET_URL })
    const resolved = await zns.resolveName('this_name_definitely_does_not_exist_xyz_123456')

    expect(resolved).toBeNull()
  })

  test('isValidName validates correctly', async () => {
    const zns = new ZNS({ url: TESTNET_URL })

    expect(zns.isValidName('alice')).toBe(true)
    expect(zns.isValidName('bob123')).toBe(true)
    expect(zns.isValidName('Alice')).toBe(false)
    expect(zns.isValidName('')).toBe(false)
  })

  test('isAvailable returns boolean', async () => {
    const zns = new ZNS({ url: TESTNET_URL })
    const result = await zns.isAvailable('xyzabc99')

    expect(typeof result).toBe('boolean')
  })
})

test.describe('ZNS name input', () => {
  test('detects bare names and supported suffixes', () => {
    expect(isZnsName('alice')).toBe(true)
    expect(isZnsName('ALICE')).toBe(true)
    expect(isZnsName('alice.zec')).toBe(true)
    expect(isZnsName('ALICE.ZEC')).toBe(true)
    expect(isZnsName('alice.zcash')).toBe(true)
    expect(isZnsName('ALICE.ZCASH')).toBe(true)
    expect(isZnsName('my-name_123.zcash')).toBe(true)
    expect(isZnsName('  alice.zcash  ')).toBe(true)
  })

  test('does not match regular addresses', () => {
    expect(isZnsName('u1qqlzrf9abc...')).toBe(false)
    expect(isZnsName('t1Rv4eNkJ...')).toBe(false)
    expect(isZnsName('utest1abc...')).toBe(false)
    expect(isZnsName(`t1${'a'.repeat(33)}`)).toBe(false)
    expect(isZnsName(`tm${'a'.repeat(33)}`)).toBe(false)
    expect(isZnsName('')).toBe(false)
  })

  test('does not match partial suffixes or invalid bare names', () => {
    expect(isZnsName('alice.zc')).toBe(false)
    expect(isZnsName('alice-name')).toBe(false)
  })

  test('normalizes all supported forms to the same name', () => {
    expect(normalizeZnsName('ZECHARIAH')).toBe('zechariah')
    expect(normalizeZnsName('ZECHARIAH.ZEC')).toBe('zechariah')
    expect(normalizeZnsName('ZECHARIAH.ZCASH')).toBe('zechariah')
  })
})
