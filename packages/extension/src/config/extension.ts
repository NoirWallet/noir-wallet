/**
 * UI configuration constants
 */

export const UI_CONFIG = {
  DAPP_WINDOW: {
    WIDTH: 375,
    HEIGHT: 632
  },

  POPUP: {
    WIDTH: 375,
    HEIGHT: 600
  }
} as const

export const EXTENSION_POPUP_PATH = 'index.html'
export const EXTENSION_SIDE_PANEL_PATH = 'index.html?surface=side-panel'

export const EXTENSION_DISPLAY_MODE_STORAGE_KEY = 'extension_display_mode'
export const DAPP_EXECUTION_MODE_STORAGE_KEY = 'dapp_execution_modes_v1'
export const SWAP_TOKEN_CATALOG_CACHE_STORAGE_KEY = 'swap_token_catalog_cache_v1'
export const LENDING_MARKET_CACHE_STORAGE_KEY = 'lending_market_cache_v1'
export const LENDING_SUPPLY_TOKEN_CACHE_STORAGE_KEY = 'lending_supply_token_cache_v1'

export const DEVELOPMENT_EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyni58fylwqC4hhsbQ/dB2ZLhFc4823YaBd/uy2wQsqSwLa8ED5ST8o+wHEu+L4fzgyNSDB1+wYfuhvWgqFpyVBvZQuxUSqHS9I89/ElPu4MY7rZMTGfRriVkglpgK9cYo8uto81+t/0RWzpUQb9dw/44PtA0xwAkOZIy0fF+CpU0gGxuL5sp7KTWEuTR5gri6ZMXy+q9HY5Yma81G50xeRPcF8KryZdrlbdkkWJLY25KgniC1wE+ULWNHzRMgBJsMKymbctbWBxXp1K25N0cQRYFzaRCPJw5LBycNtbrlNykDzHs4yZoqA5J4hSiN13rJw8+AxktRqQ8GZKjg9lCXwIDAQAB'

export function resolveDevelopmentExtensionKey(
  env: Readonly<Record<string, string | undefined>>
): string | undefined {
  if (env.EXTENSION_DEV_SERVER !== '1') return undefined
  if (env.BUILD_CHANNEL !== undefined && env.BUILD_CHANNEL !== 'development') {
    throw new Error('EXTENSION_DEV_SERVER requires BUILD_CHANNEL=development')
  }
  return DEVELOPMENT_EXTENSION_PUBLIC_KEY
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export const DEFAULT_HISTORY_API_ORIGIN = 'https://history-proxy.zknoir.com'

export function resolveHistoryApiOrigin(
  configuredOrigin: string | undefined,
  buildChannel: string
): string {
  const configured = configuredOrigin?.trim() || DEFAULT_HISTORY_API_ORIGIN
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error('EVM_HISTORY_API_ORIGIN must be an absolute URL')
  }
  const loopbackDevelopmentEndpoint =
    buildChannel === 'development' &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (
    (url.protocol !== 'https:' && !loopbackDevelopmentEndpoint) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'EVM_HISTORY_API_ORIGIN must be a credential-free HTTPS origin (loopback HTTP is development-only)'
    )
  }
  return url.origin
}

export const DAPP_CONTENT_SCRIPT_MATCHES = ['https://*/*', 'http://localhost/*'] as const

export const ZKNOIR_APP_ORIGIN = 'https://app.zknoir.com'
export const ZKNOIR_LENDING_URL = `${ZKNOIR_APP_ORIGIN}/lending`

const AUTO_CONNECT_DAPP_ORIGINS: ReadonlySet<string> = new Set([ZKNOIR_APP_ORIGIN])

export function shouldAutoConnectDApp(origin: string): boolean {
  return AUTO_CONNECT_DAPP_ORIGINS.has(origin)
}
