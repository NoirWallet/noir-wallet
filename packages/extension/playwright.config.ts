import { defineConfig } from '@playwright/test'
import { loadLocalTestWalletEnvironment } from './scripts/lib/test-wallet-env.mjs'

loadLocalTestWalletEnvironment()

/**
 * One runner, two test layers:
 *
 * - "logic": deterministic source and integration tests in Node.js
 * - "extension": the built MV3 extension in Playwright's bundled Chromium
 */
export default defineConfig({
  testDir: './tests',
  outputDir: '../../e2e-output/default',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000
  },
  projects: [
    {
      name: 'logic',
      outputDir: '../../e2e-output/logic',
      testIgnore: ['**/*.core.test.mjs'],
      testMatch: [
        '**/*.test.mjs',
        'e2e/mnemonic-validation.spec.ts',
        'e2e/multichain-runtime.spec.ts',
        'e2e/onboarding-import-race.spec.ts',
        'e2e/password-policy.spec.ts',
        'e2e/rpc-failover.spec.ts',
        'e2e/transaction-memo.spec.ts',
        'e2e/transaction-status.spec.ts',
        'e2e/transparent-history-cache.spec.ts',
        'e2e/diagnostic-logs.spec.ts',
        'e2e/zns.spec.ts'
      ]
    },
    {
      name: 'extension',
      outputDir: '../../e2e-output/extension',
      testMatch: [
        'e2e/extension-smoke-ui.spec.ts',
        'e2e/extension-security.spec.ts',
        'e2e/multichain-wasm.spec.ts',
        'e2e/credential-repository.spec.ts',
        'e2e/credential-session-lifecycle.spec.ts',
        'e2e/credential-session-resource-budget.spec.ts',
        'e2e/keystone-v1-upgrade.spec.ts',
        'e2e/mixed-v1-upgrade.spec.ts',
        'e2e/v1-golden-upgrade.spec.ts',
        'e2e/ledger-v2-provisioning.spec.ts',
        'e2e/asset-price-live.spec.ts',
        'e2e/storage-migration.spec.ts',
        'e2e/storage-quarantine.spec.ts',
        'e2e/transaction-repository.spec.ts',
        'e2e/bitcoin-discovery-repository.spec.ts',
        'e2e/wallet-cleanup.spec.ts'
      ]
    },
    {
      name: 'release-default',
      outputDir: '../../e2e-output/release-default',
      testMatch: ['e2e/release-default.spec.ts']
    },
    {
      name: 'production-dist',
      outputDir: '../../e2e-output/production-dist',
      testMatch: ['e2e/production-dist-install.spec.ts']
    },
    {
      name: 'development-extension',
      outputDir: '../../e2e-output/development-extension',
      testMatch: ['e2e/development-provider-injection.spec.ts']
    },
    {
      name: 'transaction-testnet',
      outputDir: '../../e2e-output/transaction-testnet',
      testMatch: [
        'e2e/transaction-testnet-environment.spec.ts',
        'e2e/testnet-wallet-provisioning.spec.ts',
        'e2e/funding-source-live.spec.ts'
      ]
    },
    {
      name: 'evm-testnet',
      outputDir: '../../e2e-output/evm-testnet',
      testMatch: ['e2e/evm-transfer-testnet.spec.ts']
    },
    {
      name: 'evm-testnet-live',
      outputDir: '../../e2e-output/evm-testnet-live',
      testMatch: ['e2e/evm-transfer-live-testnet.spec.ts']
    },
    {
      name: 'multichain-receive-testnet',
      outputDir: '../../e2e-output/multichain-receive-testnet',
      testMatch: ['e2e/multichain-receive-testnet.spec.ts']
    },
    {
      name: 'solana-near-portfolio-testnet',
      outputDir: '../../e2e-output/solana-near-portfolio-testnet',
      testMatch: ['e2e/solana-near-portfolio-testnet.spec.ts']
    },
    {
      name: 'solana-near-testnet-live',
      outputDir: '../../e2e-output/solana-near-testnet-live',
      testMatch: ['e2e/solana-near-transfer-live-testnet.spec.ts'],
      use: { screenshot: 'off', trace: 'off' }
    },
    {
      name: 'private-key-testnet',
      outputDir: '../../e2e-output/private-key-testnet',
      testMatch: ['e2e/private-key-wallet-testnet.spec.ts']
    },
    {
      name: 'bitcoin-testnet',
      outputDir: '../../e2e-output/bitcoin-testnet',
      testMatch: [
        'e2e/bitcoin-transfer-testnet.spec.ts',
        'e2e/bitcoin-dapp-provider-testnet.spec.ts'
      ]
    },
    {
      name: 'bitcoin-testnet-live',
      outputDir: '../../e2e-output/bitcoin-testnet-live',
      testMatch: ['e2e/bitcoin-transfer-live-testnet.spec.ts'],
      use: { screenshot: 'off', trace: 'off' }
    },
    {
      name: 'protocol-mainnet',
      outputDir: '../../e2e-output/protocol-mainnet',
      testMatch: [
        'e2e/protocol-wallet-source-mainnet.spec.ts',
        'e2e/keystone-v2-provisioning.spec.ts'
      ]
    }
  ]
})
