import { Core } from '@walletconnect/core'
import { WalletKit } from '@reown/walletkit'
import { WalletConnectController, type WalletConnectAccount } from '@/core/walletconnect/controller'
import { WalletConnectStorage } from '@/core/walletconnect/storage'
import { WalletConnectError } from '@/core/walletconnect/protocol'
import { accountManager } from '@/core/wallet/account-manager'
import { SecureStorage } from '@/core/wallet/secure-storage'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { DEFAULT_NETWORK } from '@/config/networks'
import { isHardwareKeySource } from '@/lib/hardware-capabilities'
import { isExtensionPageSender } from '@/lib/extension-sender'
import { getAccountDisplayName } from '@/lib/format'
import { DedupPromise, withTimeout } from '@/lib/async-utils'
import { needsUnlock } from '@/lib/lock-utils'
import { logger } from '@/lib/logger'
import { dappHandler } from './dapp-handler'

const storage = new WalletConnectStorage()
const accountRestore = new DedupPromise<WalletConnectAccount | null>()
const KEEPALIVE_ALARM = 'walletconnect-session-restore'
const projectId =
  import.meta.env.VITE_REOWN_PROJECT_ID?.trim() || '669d1b9f59163a92d90a3c1ff78a7326'

async function getAccount(): Promise<WalletConnectAccount | null> {
  return accountRestore.run(async () => {
    await rehydrateWalletStore()
    await accountManager.initialize()
    if (await needsUnlock()) return null
    if (accountManager.isLocked()) {
      const password = await SecureStorage.getSessionPassword()
      if (!password || !(await accountManager.unlock(password)).success) return null
    }
    const state = useWalletStore.getState()
    const account = accountManager.getCurrentAccount()
    const wallet = state.getCurrentWallet()
    if (
      state.currentNetwork !== 'mainnet' ||
      !wallet ||
      !account ||
      state.currentAccountId !== account.id ||
      !wallet.accounts.some(item => item.id === account.id) ||
      isHardwareKeySource(wallet.keySource)
    )
      return null
    return {
      walletId: wallet.id,
      accountId: account.id,
      label: getAccountDisplayName(wallet.id, account.id, account.name, state.accountDisplayNames),
      addresses: { ...account.addresses }
    }
  })
}

async function openConnectionPage(): Promise<void> {
  const url = chrome.runtime.getURL('index.html#/walletconnect?tab=1')
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find(tab => tab.url === url)
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined)
      await chrome.windows.update(existing.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url })
  }
}

export const walletConnect = new WalletConnectController({
  enabled: DEFAULT_NETWORK === 'mainnet',
  createClient: async () => {
    const core = new Core({
      projectId,
      storage,
      customStoragePrefix: 'noir-wallet-v1',
      telemetryEnabled: false,
      logger: 'silent'
    })
    const client = await withTimeout(
      WalletKit.init({
        core,
        metadata: {
          name: 'Noir Wallet',
          description: 'Zcash wallet',
          url: 'https://zknoir.com',
          icons: []
        }
      }),
      20_000,
      'WalletConnect initialization'
    )
    // A suspended MV3 worker reconnects to the relay and drains queued requests on wake.
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 })
    return client
  },
  getAccount,
  loadBindings: () => storage.getItem('bindings'),
  loadConsumedRequests: () => storage.getItem('consumedRequests'),
  hasStoredClient: async () =>
    (await storage.getKeys()).some(key => key !== 'bindings' && key !== 'consumedRequests'),
  saveBindings: bindings => storage.setItem('bindings', bindings),
  saveConsumedRequests: keys => storage.setItem('consumedRequests', keys),
  request: (authorization, request) =>
    dappHandler.handleWalletConnectRequest(authorization, request),
  updated: () => {
    void chrome.runtime.sendMessage({ type: 'WALLETCONNECT_UPDATED' }).catch(() => {})
  },
  proposalReceived: openConnectionPage,
  failed: stage => logger.warn(`WalletConnect ${stage} failed`)
})

export function initializeWalletConnect(): void {
  void walletConnect.start().catch(() => logger.warn('WalletConnect session restoration failed'))
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== KEEPALIVE_ALARM) return
    void storage
      .getKeys()
      .then(async keys => {
        if (!keys.some(key => key !== 'bindings' && key !== 'consumedRequests')) {
          await chrome.alarms.clear(KEEPALIVE_ALARM)
          return
        }
        await walletConnect.start()
      })
      .catch(() => logger.warn('WalletConnect relay restoration failed'))
  })
}

export async function handleWalletConnectMessage(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  if (!isExtensionPageSender(sender))
    throw new WalletConnectError(
      'WalletConnect controls are available only inside Noir Wallet',
      4100
    )
  switch (message.type) {
    case 'WALLETCONNECT_GET_STATE':
      return { success: true, state: await walletConnect.state() }
    case 'WALLETCONNECT_PAIR':
      await walletConnect.pair(message.uri)
      break
    case 'WALLETCONNECT_APPROVE':
    case 'WALLETCONNECT_REJECT':
      if (typeof message.proposalId !== 'number' || !Number.isSafeInteger(message.proposalId))
        throw new WalletConnectError('Invalid connection request')
      if (message.type === 'WALLETCONNECT_APPROVE') await walletConnect.approve(message.proposalId)
      else await walletConnect.reject(message.proposalId)
      break
    case 'WALLETCONNECT_DISCONNECT':
      if (typeof message.topic !== 'string' || !/^[a-f0-9]{64}$/i.test(message.topic))
        throw new WalletConnectError('Invalid session')
      await walletConnect.disconnect(message.topic)
      break
    default:
      throw new WalletConnectError('Unsupported WalletConnect action', 4200)
  }
  return { success: true }
}
