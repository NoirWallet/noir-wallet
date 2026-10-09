# Noir Wallet

A privacy-focused Zcash and multichain Chrome wallet with a dApp SDK.

## Project Structure

```
noir-wallet/
├── packages/
│   ├── extension/            # Chrome Extension wallet
│   ├── sdk/                  # dApp SDK (Git submodule)
│   │   └── example/          # SDK integration example app
│   ├── web/                  # Website
│   ├── docs/                 # User and developer documentation site
│   ├── rpc-registry/         # Managed RPC registry
│   └── zcash-wallet-wasm/    # Nested Rust/WASM wallet repository
├── docs/                     # Maintainer reference guides
├── package.json
└── pnpm-workspace.yaml
```

## Documentation

- [Project rules and documentation ownership](./AGENTS.md), including [architecture](./AGENTS.md#architecture)
- [Wallet user guide](./packages/docs/content/docs/wallet-guide/index.mdx)
- [SDK integration guide](./packages/docs/content/docs/noir-sdk-integration.mdx) and [provider API](./packages/docs/content/docs/developers/provider-api.mdx)
- [Multichain product and architecture index](./docs/mutil-chain/README.md)
- [Analytics events](./docs/analytics-events.md) and [error messages](./docs/error-messages.md)
- [Release operations](./docs/release-workflow.md) and [developer release history](./CHANGELOG.md)

The documentation site's source is `packages/docs/content/docs/`. The top-level `docs/` directory contains English maintenance references. Internal plans, reviews, and historical project records are retained separately in the private project archive.

## Features

- **Privacy-First**: Zero-knowledge proofs for private transactions with shielded addresses
- **Worker-Based WASM**: Offscreen worker architecture for non-blocking cryptographic operations
- **Multichain Accounts**: Released EVM and Bitcoin networks follow the wallet's global Mainnet/Testnet Mode; other chains are feature-gated
- **dApp Integration**: TypeScript SDK for seamless wallet connection and transaction signing
- **Optimistic UI**: Instant interface response with background computation for better UX

## Quick Start

Run commands from the repository root with Node.js 22 and the pnpm version in `package.json`. Initialize the SDK Git submodule before installing dependencies:

```bash
git submodule update --init packages/sdk
```

### Install Dependencies

```bash
pnpm install
```

### Development

Start the development servers with hot reload:

```bash
# Start extension + website + SDK example together (recommended)
pnpm dev

# Extension only
pnpm dev:extension

# Website only
pnpm dev:web

# Example app only (SDK showcase)
pnpm dev:example

# SDK development (watch mode)
pnpm --filter @noir-wallet/sdk dev

# Documentation site
pnpm dev:docs
```

**Note**:

- After starting `pnpm dev:extension`, load `packages/extension/dist-dev/` in `chrome://extensions` with Developer Mode enabled. Generated build and test output is excluded from HMR so verification builds do not reload the development extension.
- EVM History uses the deployed proxy by default. Set `EVM_HISTORY_API_ORIGIN` only to use another proxy; configuration details are in the [release runbook](docs/release-workflow.md#verification-and-build).
- Main local entrypoints match production routes:
  - `http://localhost:5001`
  - `http://localhost:5001/beta`
- The SDK example runs separately at `http://localhost:5002/example/` so it can be tested with the extension injection flow intact

### Build

```bash
# Build all packages
pnpm build

# Build specific packages
pnpm build:extension
pnpm build:extension:testnet
pnpm --filter @noir-wallet/sdk build
pnpm build:web
pnpm build:docs
```

### Type Checking and Tests

Build the SDK before checking the whole workspace so its example can resolve the generated declarations.

```bash
pnpm --filter @noir-wallet/sdk build
pnpm type-check
pnpm test
pnpm --filter @noir-wallet/extension test:logic
pnpm --filter @noir-wallet/extension test:extension
```

`pnpm test` runs the deterministic native core suite used by CI. Add committed core cases as flat `packages/extension/tests/*.core.test.mjs` files; ordinary `*.test.mjs` files remain in the local Playwright logic suite and do not enter CI. The Playwright commands are retained for local logic and real MV3 checks. See [Automated Testing](./AGENTS.md#automated-testing) for the test layout and local build requirements.

### Load Extension in Chrome

1. Build the extension: `pnpm build:extension`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist` directory

## Example Application

The SDK submodule includes an example application:

```bash
# Start example app
pnpm --filter @noir-wallet/example dev

# Build example app
pnpm --filter @noir-wallet/example build
```

The example runs at http://localhost:5002/example/ and demonstrates:

- Wallet connection and detection
- Account and balance queries
- Transaction sending
- Message signing
- Event listeners (accountsChanged, chainChanged)

**Requirements**: Noir Wallet extension must be installed and loaded in Chrome.
The current V2 extension supports the optional `fundingSource` parameter for SDK Max estimates and sends. See the [provider API](./packages/docs/content/docs/developers/provider-api.mdx) for account and hardware limitations.

## SDK Usage

- [SDK integration guide](./packages/docs/content/docs/noir-sdk-integration.mdx): installation, provider detection, account access, and examples.
- [Provider API](./packages/docs/content/docs/developers/provider-api.mdx): methods, request and response types, and limitations.
- [SDK package README](./packages/sdk/README.md): package installation and quick start.

## Release

See the [CI/CD and release runbook](./docs/release-workflow.md) for beta builds, production
tags, GitHub Releases, Chrome Web Store submission, failure recovery, and the migration away
from the historical `staging` branch.

## License

[MIT](./LICENSE). The bundled Jost and DM Mono fonts carry their own [SIL Open Font License notices](./packages/extension/public/fonts/).
