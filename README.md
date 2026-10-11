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
│   ├── sdk/                  # dApp SDK
│   │   └── example/          # SDK integration example app
│   ├── web/                  # Landing page and installation guide
│   │   └── tests/            # Website voting contract tests
│   ├── web-vote/             # Website FROST voting Worker
│   │   └── tests/            # Voting API and persistence tests
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

Run commands from the repository root. Use the Node.js version in [`.node-version`](./.node-version) and the pnpm version declared in `package.json` to match CI. Node.js 22 or newer is supported:

```bash
git clone https://github.com/NoirWallet/noir-wallet.git
cd noir-wallet
```

The SDK and its example are included in the clone. The source under `packages/zcash-wallet-wasm/` is a separate checkout, not a Git submodule, and is excluded from this pnpm workspace. Ordinary extension builds use the vendored package at `packages/extension/src/lib/wasm-pkg/` and do not require that source checkout. Updating the vendored package requires access to the WASM source or a published artifact and must follow the [WASM package workflow](./AGENTS.md#wasm-package-workflow). Do not replace the vendored package with an unrelated build.

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

This command builds the SDK before checking all workspace packages, so consumers can resolve its exported JavaScript and declaration files on a fresh checkout. The pre-commit hook uses the same command.

### Core Tests

The root command aggregates the extension, RPC registry, website voting client, and voting Worker core suites:

```bash
pnpm test

# Run one package's core suite
pnpm --filter @noir-wallet/extension test
pnpm --filter @noir-wallet/rpc-registry test
pnpm --filter @noir-wallet/web test
pnpm --filter @noir-wallet/web-vote test

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
- [SDK package README](./packages/sdk/README.md): package installation and quick start.

## RPC Registry Service

`packages/rpc-registry/` is a Cloudflare Worker serving `GET /v1/rpc-endpoints`; add `?scope=multichain` for the full registry. `GET /v1/zero-indexer-endpoints` serves independent Mainnet and Testnet broadcast-node lists maintained in [zero-indexer-registry.ts](./packages/rpc-registry/src/zero-indexer-registry.ts). The extension uses cached or bundled ZeroIndexer nodes when that API is unavailable. Its scheduled monitor checks ordinary RPC availability and sends Slack notifications; ZeroIndexer nodes are excluded from that monitor. The domain, schedule, and Durable Object migration are defined in [wrangler.jsonc](./packages/rpc-registry/wrangler.jsonc).

From the repository root, verify the service without deploying or sending notifications:

```bash
pnpm --filter @noir-wallet/rpc-registry verify # Type checking, core tests, and build dry run
pnpm --filter @noir-wallet/rpc-registry dev   # Local API at http://localhost:8787
```

Set `SLACK_WEBHOOK_URL` as a Worker secret for notifications. Local scheduled runs also probe external RPCs and can send notifications when this secret is configured. Failed deliveries remain pending and are retried on a later scheduled run.

## FROST Community Vote

The website's independent `/frost` page introduces the planned Mobile + Chrome Extension 2-of-2 FROST vault and accepts votes in favor or against, with separate counts. It does not change the landing page. The API is a separate Cloudflare Worker in `packages/web-vote/`; the RPC monitoring Worker is unchanged.

Run both servers from the repository root:

```bash
pnpm --filter @noir-wallet/web-vote dev
pnpm dev:web
```

Open `http://localhost:5001/frost`. Vite proxies `/api/frost-votes` to the local Worker on port 8788. Local votes persist under ignored `output/web-vote/state/`, separately from production.

The API accepts `GET /api/frost-votes` for `{ total, support, oppose, choice }` and `POST /api/frost-votes` to vote. The browser supplies its anonymous UUID in `X-Voter-ID` and the selected `support` or `oppose` option in `X-Vote-Choice`; POST requires a configured website Origin and no request body. Reads without an ID return the counts with `choice: null`. Personalized responses are never cached. A SQLite-backed Durable Object stores hashed browser IDs, their choices, and aggregate counts, with transactional duplicate prevention. Each browser's first successful vote is final; retries, including a different choice, return the existing vote without changing either count. Existing support-only votes migrate to `support` without resetting counts or voter identities.

Identity is scoped to the website origin in one browser, not physical hardware. Clearing browser data, private browsing, another browser, or using another website origin can produce a new identity. This is an informal interest poll and does not establish unique people or resist deliberate vote farming. No wallet connection or device fingerprint is used. If browser storage is unavailable, voting is disabled instead of issuing temporary IDs.

Verify before deployment:

```bash
pnpm --filter @noir-wallet/web-vote verify
pnpm --filter @noir-wallet/web type-check
pnpm build:web
pnpm test
```

The website keeps its existing Cloudflare Pages Git deployment. The voting Worker has an independent [GitHub Actions workflow](./.github/workflows/web-vote.yml). See [website and voting Worker deployment](./docs/release-workflow.md#website-and-voting-worker) for one-time credentials setup, triggers, and recovery. The Worker routes, allowed production origins, and Durable Object migration are maintained in [wrangler.jsonc](./packages/web-vote/wrangler.jsonc). Routes cover only the voting API paths; the existing Pages site serves `/frost` and all other pages. Local verification does not confirm production routing or deployment.

## Release

See the [CI/CD and release runbook](./docs/release-workflow.md) for beta builds, production
tags, GitHub Releases, Chrome Web Store submission, failure recovery, and the migration away
from the historical `staging` branch.

## License

[MIT](./LICENSE). Extension ZIPs include this license. Bundled Jost and DM Mono fonts use the SIL Open Font License; their [Jost](./packages/extension/public/fonts/jost-OFL.txt) and [DM Mono](./packages/extension/public/fonts/dm-mono-OFL.txt) license texts are included with the fonts.

The SDK is included under this project's [MIT license](./LICENSE) and retains its [package license](./packages/sdk/LICENSE). The Rust/WASM source is a separate repository; verify its licensing and third-party attribution before redistribution.
