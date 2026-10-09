export const DAPP_CONTENT_SCRIPT_MATCHES = ['https://*/*', 'http://localhost/*'] as const

export const ZKNOIR_APP_ORIGIN = 'https://app.zknoir.com'
export const ZKNOIR_LENDING_URL = `${ZKNOIR_APP_ORIGIN}/lending`

const AUTO_CONNECT_DAPP_ORIGINS: ReadonlySet<string> = new Set([ZKNOIR_APP_ORIGIN])

export function shouldAutoConnectDApp(origin: string): boolean {
  return AUTO_CONNECT_DAPP_ORIGINS.has(origin)
}
