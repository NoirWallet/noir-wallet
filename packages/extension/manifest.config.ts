import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json'
import { DAPP_CONTENT_SCRIPT_MATCHES } from './src/config/dapp-matches'
import { EXTENSION_SIDE_PANEL_PATH } from './src/config/extension-display'

const { version, description } = packageJson

const extensionVersion = version.split('-')[0]
const isTestnet = process.env.NETWORK_MODE === 'testnet'

export default defineManifest(async env => ({
  manifest_version: 3,
  minimum_chrome_version: '120',
  name: isTestnet
    ? '[Testnet] Noir Wallet'
    : env.mode === 'staging'
      ? '[Staging] Noir Wallet'
      : 'Noir Wallet',
  version: extensionVersion,
  description,
  permissions: ['storage', 'offscreen', 'notifications', 'alarms', 'sidePanel'],
  host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*', 'http://[::1]/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  action: {
    default_icon: {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    }
  },
  side_panel: {
    default_path: EXTENSION_SIDE_PANEL_PATH
  },
  icons: {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png'
  },
  content_scripts: [
    {
      matches: [...DAPP_CONTENT_SCRIPT_MATCHES],
      js: ['src/content-script/index.ts'],
      run_at: 'document_start'
    },
    {
      matches: [...DAPP_CONTENT_SCRIPT_MATCHES],
      js: ['src/content-script/inject-provider.ts'],
      run_at: 'document_start',
      world: 'MAIN'
    }
  ],
  web_accessible_resources: [
    {
      resources: ['assets/*.js', 'assets/*.css'],
      matches: [...DAPP_CONTENT_SCRIPT_MATCHES]
    }
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https: wss://relay.walletconnect.com wss://relay.walletconnect.org http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;"
  },
  cross_origin_embedder_policy: {
    value: 'require-corp'
  },
  cross_origin_opener_policy: {
    value: 'same-origin'
  }
}))
