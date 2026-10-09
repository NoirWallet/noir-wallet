# Noir Wallet

A self-custodial Zcash Chrome wallet with shielded transactions, cross-chain swaps, lending, and a dApp SDK.

## Project Structure

```
noir-wallet/
├── packages/
│   ├── extension/            # Chrome Extension wallet
│   │   └── tests/            # Wallet core tests
│   ├── rpc-registry/         # RPC registry and monitoring service
│   │   └── tests/            # Service core tests
│   ├── sdk/                  # dApp SDK (Git submodule)
│   │   └── example/          # SDK integration example app
│   ├── web/                  # Landing page and installation guide
│   ├── docs/                 # User and developer documentation site
│   └── zcash-wallet-wasm/    # Separate Rust/WASM repository, if available locally
├── docs/                     # Internal references, release and integration guides
├── output/                   # Ignored local verification artifacts
├── package.json
└── pnpm-workspace.yaml
```

## Documentation

- [Project rules and document maintenance](./AGENTS.md), including [architecture responsibilities](./AGENTS.md#architecture)
- [Wallet user guide](./packages/docs/content/docs/wallet-guide/index.mdx)
- [SDK integration and package references](#sdk-usage)
- Module references: [analytics events](./docs/analytics-events.md) and [error messages](./docs/error-messages.md)
- [Release operations](#release) and [developer release history](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md), [security reporting](./SECURITY.md), and [license](./LICENSE)

The documentation site is maintained in `packages/docs/content/docs/`. The top-level `docs/` directory holds internal references, release procedures, and integration checks.

## Features

- **Zcash Privacy**: Shielded addresses and funding when available; transparent activity remains public on-chain
- **Worker-Based WASM**: Offscreen worker architecture for non-blocking cryptographic operations
- **Cross-Chain Flows**: Supported asset swaps and lending on mainnet through external services
- **dApp Integration**: TypeScript SDK for seamless wallet connection and transaction signing
- **Optimistic UI**: Instant interface response with background computation for better UX

## Quick Start

Run commands from the repository root. Use the Node.js version in [`.node-version`](./.node-version) and the pnpm version declared in `package.json` to match CI. Node.js 22 or newer is supported. Clone with submodules to check out the separate SDK repository at the pinned commit:

```bash
git clone --recurse-submodules https://github.com/NoirWallet/noir-wallet.git
cd noir-wallet
```

If you already cloned the repository, run `git submodule update --init packages/sdk`. An inaccessible submodule blocks workspace installation and SDK builds. The source under `packages/zcash-wallet-wasm/` is a separate checkout, not a Git submodule, and is excluded from this pnpm workspace. Ordinary extension builds use the vendored package at `packages/extension/src/lib/wasm-pkg/` and do not require that source checkout. Updating the vendored package requires access to the WASM source or a published artifact and must follow the [WASM package workflow](./AGENTS.md#wasm-package-workflow). Do not replace the vendored package with an unrelated build.

No `.env` file or analytics credentials are required for local development, default builds, beta builds, or testnet builds. Production mainnet builds require the process environment variables listed in [`.env.example`](./.env.example); see the [release configuration](./docs/release-workflow.md#workflow-stages). Those values are embedded in the extension and are visible to its users, so they must not grant privileged server access.

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

- After starting `pnpm dev:extension`, load the `packages/extension/dist/` directory in `chrome://extensions` with Developer Mode enabled
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
pnpm --filter @noir-wallet/example build
pnpm build:web
pnpm build:docs
```

Website builds use `NoirWallet/noir-wallet` for the `/github` and `/beta/versions` redirects by default. Set `WALLET_REPOSITORY=owner/repo` when building `packages/web` to point both routes at another GitHub repository and its Releases page. The value is validated during the build; see [`.env.example`](./.env.example).

### Type Checking

```bash
pnpm type-check
```

### Core Tests

The root command aggregates the extension and RPC registry core suites:

```bash
pnpm test

# Run one package's core suite
pnpm --filter @noir-wallet/extension test
pnpm --filter @noir-wallet/rpc-registry test

# Run one core regression test
pnpm --filter @noir-wallet/extension exec node --import ../../scripts/register-test-loader.mjs --test tests/tx-monitor-policy.test.mjs
```

See [automated testing rules](./AGENTS.md#automated-testing) for suite scope, test-authoring requirements, local real-MV3 browser verification, and artifact locations.

### Load Extension in Chrome

1. Build the extension: `pnpm build:extension`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist` directory

## Example Application

The application in `packages/sdk/example/` uses the entrypoint and commands in [Development](#development) and [Build](#build). It demonstrates:

- Wallet connection and detection
- Account and balance queries
- Transaction sending
- Message signing
- Event listeners (accountsChanged, chainChanged)

**Requirements**: Noir Wallet extension must be installed and loaded in Chrome.
The optional `fundingSource` parameter for SDK Max estimates and sends is
supported by Noir Wallet extension **1.0.27 or later**.

## SDK Usage

- [SDK integration guide](./packages/docs/content/docs/noir-sdk-integration.mdx): installation, provider detection, account access, and usage examples.
- [API reference](./packages/docs/content/docs/developers/provider-api.mdx): methods, request and response types, and limitations.
- [SDK package README](https://github.com/NoirWallet/noir-wallet-sdk/blob/main/README.md): the independent package's installation and quick start.

## RPC Registry Service

`packages/rpc-registry/` is a Cloudflare Worker serving `GET /v1/rpc-endpoints`; add `?scope=multichain` for the full registry. Its scheduled monitor checks RPC availability and sends Slack notifications. The domain, schedule, and Durable Object migration are defined in [wrangler.jsonc](./packages/rpc-registry/wrangler.jsonc).

From the repository root, verify the service without deploying or sending notifications:

```bash
pnpm --filter @noir-wallet/rpc-registry verify # Type checking, core tests, and build dry run
pnpm --filter @noir-wallet/rpc-registry dev   # Local API at http://localhost:8787
```

Set `SLACK_WEBHOOK_URL` as a Worker secret for notifications. Local scheduled runs also probe external RPCs and can send notifications when this secret is configured. Failed deliveries remain pending and are retried on a later scheduled run.

## Release

See the [CI/CD and release runbook](./docs/release-workflow.md) for beta builds, production
tags, GitHub Releases, Chrome Web Store submission, failure recovery, and the migration away
from the historical `staging` branch.

## License

[MIT](./LICENSE). Extension ZIPs include this license. Bundled Jost and DM Mono fonts use the SIL Open Font License; their [Jost](./packages/extension/public/fonts/jost-OFL.txt) and [DM Mono](./packages/extension/public/fonts/dm-mono-OFL.txt) license texts are included with the fonts.

The SDK and Rust/WASM source are separate repositories. Verify their licensing and third-party attribution before redistribution; this project's MIT license does not replace those terms.
