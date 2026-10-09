/**
 * Noir Wallet Provider - Multi-chain provider injected into the page
 * Communicates with content-script via window.postMessage
 */

interface ChainProvider {
  request: (args: { method: string; params?: any[] }) => Promise<any>
  on: (event: string, handler: (...args: any[]) => void) => void
  removeListener: (event: string, handler: (...args: any[]) => void) => void
  disconnect: () => Promise<void>
}

interface NoirWalletProvider {
  isNoirWallet: boolean
  version: string
  zcash: ChainProvider
}

const eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map()
const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'

function generateRequestId(): string {
  return `noir_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

function createChainProvider(chainId: string): ChainProvider {
  return {
    async request({ method, params }) {
      return new Promise((resolve, reject) => {
        const requestId = generateRequestId()

        const timeoutHandle = setTimeout(() => {
          window.removeEventListener('message', responseHandler)
          reject(new Error('Request timeout'))
        }, 300000)

        const responseHandler = (event: MessageEvent) => {
          if (event.source !== window) return
          if (event.data?.target !== 'noir-provider') return
          if (event.data?.requestId !== requestId) return

          clearTimeout(timeoutHandle)
          window.removeEventListener('message', responseHandler)

          const { result, error } = event.data

          if (error) {
            console.error(`[Noir Wallet Provider - ${chainId}] request error:`, error)
            reject(new Error(error))
          } else {
            resolve(result)
          }
        }

        window.addEventListener('message', responseHandler)

        window.postMessage(
          {
            target: 'noir-content-script',
            type: 'NOIR_REQUEST',
            requestId,
            chainId,
            payload: { method, params }
          },
          '*'
        )
      })
    },

    on(event, handler) {
      const key = `${chainId}:${event}`
      if (!eventListeners.has(key)) {
        eventListeners.set(key, new Set())
      }
      eventListeners.get(key)!.add(handler)
    },

    removeListener(event, handler) {
      const key = `${chainId}:${event}`
      const handlers = eventListeners.get(key)
      if (handlers) {
        handlers.delete(handler)
      }
    },

    async disconnect() {
      return this.request({ method: 'zcash_disconnect', params: [] })
    }
  }
}

const noirWalletProvider: NoirWalletProvider = Object.freeze({
  isNoirWallet: true,
  version: appVersion,
  zcash: Object.freeze(createChainProvider('zcash')) as ChainProvider
})

window.addEventListener('message', event => {
  if (event.source !== window) return
  if (event.data?.target !== 'noir-provider') return
  if (event.data?.type !== 'NOIR_EVENT') return

  const { chainId, eventName, data } = event.data
  const key = `${chainId}:${eventName}`
  const handlers = eventListeners.get(key)

  if (handlers) {
    handlers.forEach(handler => {
      try {
        handler(data)
      } catch (error) {
        console.error(`[Noir Wallet Provider - ${chainId}] Event handler error:`, error)
      }
    })
  }
})

Object.defineProperty(window, 'noirwallet', {
  value: noirWalletProvider,
  writable: false,
  configurable: false,
  enumerable: true
})

window.dispatchEvent(new Event('noirwallet#initialized'))

console.log('[Noir Wallet Provider] Injected successfully')
