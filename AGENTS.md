# AGENTS.md - Noir Wallet Project Guidelines

This file is the canonical project guide for coding agents and contributors. `CLAUDE.md` points here instead of duplicating these instructions. Keep shared instructions here and update affected documentation according to the ownership below.

## Documentation Governance

These rules apply to documentation-only work as well as documentation affected by code changes.

### Ownership

| Content                                                      | Authoritative location                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Project overview and local development, test, and build      | [README.md](./README.md)                                                                                                       |
| AI work rules, architecture, and development constraints     | `AGENTS.md`; `CLAUDE.md` only directs readers here                                                                             |
| Published wallet guides and SDK integration/API explanations | Source MDX under [packages/docs/content/docs/](./packages/docs/content/docs/)                                                  |
| SDK package installation and package-local quick start       | [SDK README](./packages/sdk/README.md) in this workspace                                                                       |
| Module-specific reference material                           | Existing topic documents such as [analytics events](./docs/analytics-events.md) and [error messages](./docs/error-messages.md) |
| Multichain maintenance reference                             | [Multichain documentation index](./docs/mutil-chain/README.md); runtime registries and capabilities define released behavior   |
| Task-specific operations and recovery                        | [Release runbook](./docs/release-workflow.md) and existing operational guides under `docs/`                                    |
| Developer release history and user-facing update notes       | [CHANGELOG.md](./CHANGELOG.md) and `packages/web/public/changelog.json`, respectively                                          |
| Internal plans, audits, and historical project records       | Private project records; do not import them into the public maintenance reference                                              |

Documentation explains verified implementation facts; code, configuration, and public types remain the implementation sources of truth. Check SDK contracts against `packages/sdk/src/chains/zcash/types.ts` and the extension provider implementation. The documentation site's generated output is not a separate maintenance source. Classify existing topic documents by content before treating them as current guidance. Verify chain registries, enabled feature flags, and runtime capabilities before presenting behavior as available to users.

### Maintenance Rules

1. Search existing documentation before adding a document. Update the existing authoritative location by default. Create a document only for a clear audience, durable purpose, and independent ownership that no existing location can reasonably accommodate; do not create empty documents, placeholder directories, or templates.
2. Keep temporary analysis, task progress, implementation diaries, and delivery summaries in chat or an existing temporary workspace. Add lasting records only when the user requests them, an established project workflow requires them, or they have clear long-term maintenance value.
3. Maintain each fact in one authoritative location. Elsewhere, link rather than duplicate configuration, steps, rules, or explanatory passages. For generated content, maintain its source instead of manually editing the output.
4. Verify current-state descriptions against code, configuration, tests, and actual execution results. Do not infer features, defaults, interfaces, limits, or support. State what could not be verified; never claim verification, completion, or support without evidence.
5. Check documentation impact with every code change. Update the authoritative documentation when usage, public interfaces, configuration, defaults, architecture boundaries, or development and deployment steps change. If there is no documentation impact, do not manufacture a documentation edit.
6. Update obsolete guidance or retire it from current usage paths, updating replacement links so contradictory guides do not coexist. Preserve historical decisions, retrospectives, audits, and valuable implementation plans, clearly distinguished from current guidance. Ask before changing material whose ownership or retention value is unclear.
7. Remove repetition, code narration, irrelevant background, and development-process detail. Preserve prerequisites, key behavior, limits, failure feedback, and recovery paths needed to complete the reader's task; brevity alone is not the goal. Product UI copy follows the separate project copy rule: do not display standing business-rule explanations that controls and feedback can convey.
8. Maintained source comments, public API JSDoc, and public maintenance documentation use English. Keep internal planning and historical project records in the private project archive; do not import them into public commits. Follow the existing formatting conventions.

## Project Overview

Noir Wallet is a privacy-focused Zcash wallet monorepo containing a Chrome extension, a dApp SDK, a website, a documentation site, and a nested Rust/WASM wallet repository. See the [README project structure](./README.md#project-structure) for the directory overview.

`packages/zcash-wallet-wasm` is a separate Git repository. Its generated package is copied into `packages/extension/src/lib/wasm-pkg/`, which is tracked by the top-level repository.

## Architecture

The extension separates UI and orchestration from wallet computation:

```text
Popup / approval / full-tab UI
             │ chrome.runtime messages
Background service worker
             │ creates and owns the offscreen document
Offscreen document
             │ postMessage
Web Worker + packaged Zcash WASM
```

- The popup renders account state and initiates actions.
- The background service worker owns dApp requests, transaction recording, monitoring, scheduled sync, and popup-window coordination.
- The offscreen document keeps the compute worker available outside short-lived popup windows.
- The worker/WASM layer performs wallet initialization, scanning, key derivation, transaction construction, and persistence.

The Multichain command protocol lives in `packages/extension/src/core/keyring/protocol/`, its transport contract in `src/core/keyring/ports/keyring-transport.ts`, and its client in `src/infrastructure/keyring/multichain/command-client.ts`. These are internal extension modules; `packages/sdk` is the public dApp SDK.

### Optimistic UI

Do not block page rendering on WASM or network initialization.

- Render content immediately when enough local state exists.
- Disable actions until their prerequisites are ready.
- Wait for account/WASM readiness inside the action handler.
- After a Zcash transaction is broadcast and local bookkeeping succeeds, notify the popup before starting non-critical catch-up sync.
- Keep long-running sync and monitoring work in the background.

## Current Technology Stack

### Extension

- React 19, TypeScript 5.9, Vite 7, CRXJS, Manifest V3
- Tailwind CSS 4 and shadcn-style UI primitives
- Zustand 5 with Chrome storage adapters
- `@iconify/react` using Lucide and Radix icon sets
- `@rhea-finance/cross-chain-sdk` for lending and cross-chain flows
- Packaged Zcash WASM running in a Web Worker
- Node.js native test runner for committed core tests; Playwright for existing local tools

### SDK

- TypeScript 5.9
- tsup output in ESM, CJS, and declaration formats
- Public exports from `@noir-wallet/sdk` and `@noir-wallet/sdk/chains/zcash`

### Website

- React 19, TypeScript 5.8, Vite 7, Tailwind CSS 4

### Tooling

- pnpm 10 workspace
- Node.js 22 in CI
- GitHub Actions publishes one extension artifact with a global Mainnet/Testnet Mode

Use versions from the relevant `package.json` as the source of truth when this summary becomes stale.

## Common Commands

Use the [README quick start](./README.md#quick-start) for installation, development, build, type-check, and routine test commands. Verify scripts against the relevant `package.json` before running them. Specialized extension checks are below; run them from the repository root.

```bash
# Verify the production package excludes test harness and diagnostics
pnpm --filter @noir-wallet/extension test:production-dist

# Verify MAIN-world provider injection against the running HMR extension
DEV_EXTENSION_E2E=1 pnpm --filter @noir-wallet/extension exec playwright test --project=development-extension --workers=1

# Opt-in local 100-Wallet KDF and Chrome process-tree RSS check
RESOURCE_BUDGET_E2E=1 pnpm --filter @noir-wallet/extension exec playwright test --project=extension tests/e2e/credential-session-resource-budget.spec.ts --workers=1
```

`pnpm dev:extension` writes the CRXJS HMR extension to `packages/extension/dist-dev/`. Load that directory as the unpacked development extension. Production builds continue to use `packages/extension/dist/`, so build and release verification cannot overwrite the active HMR extension.

### Build Artifact Directories

Extension builds use exactly three generated roots:

- `packages/extension/dist/` is the Mainnet-default production and release build.
- `packages/extension/dist-dev/` is the single CRXJS HMR build. Do not delete it while its Vite server is running or while it is the unpacked extension under active review.
- `packages/extension/e2e-dist/<profile>/` contains every automated or local verification build. The standalone Testnet production-like check uses `e2e-dist/testnet-build-check/`; Playwright profiles keep their own network-and-feature-qualified subdirectory.

Do not create `dist-testnet/`, `e2e-dist-testnet/`, or another extension build root. Generated build directories are gitignored and may be deleted after confirming no active dev server or browser test depends on them. Keep user-review screenshots in `e2e-output/` for the rest of the current turn even when their corresponding build directory is cleaned.

## Automated Testing

Root `pnpm test` runs the extension's deterministic `node:test` core suite through `scripts/run-core-tests.mjs`. The runner discovers flat `tests/*.core.test.mjs` files and uses the package's TypeScript compiler to load source modules. Pull requests and release builds run this suite without a browser, wallet, hardware, or network service.

The SDK and example are workspace packages under `packages/sdk/`. Their dedicated workflow runs SDK type-check and native tests, example type-check and build, and a package dry run. Root `pnpm test` remains the wallet core suite.

The V2 checkout also retains its existing Playwright tools. `test:logic` runs the remaining Node-based Playwright tests; `test:extension`, `test:release:default`, and `test:production-dist` run local browser checks. The last command supplies test-only build values and writes a local `dist/` package that must not be published. These tools are available for focused development verification and are not standard CI or release gates. The older tracked `tests/e2e/` layout has not yet been moved to the ignored `tests/.local/` location; do not add new browser or live tests to the tracked suite.

```text
packages/extension/
├── e2e-dist/                       # Profile-isolated verification builds, gitignored
├── playwright.config.ts
└── tests/
    ├── *.core.test.mjs             # Standard node:test core suite
    ├── *.test.mjs                  # Existing local Playwright logic tools
    └── e2e/
        ├── extension-fixtures.ts   # Real extension fixture
        ├── extension-smoke-ui.spec.ts
        ├── v1-golden-upgrade.spec.ts
        └── *.spec.ts               # Selected logic/integration tests
```

### Test Rules

- Only add tests for core business rules, public contracts, security boundaries, and defects likely to regress. Do not add one-off source-text assertions, implementation-wiring checks, or tests that merely restate constants and component markup.
- Prefer a small behavior-focused test that survives refactoring. Standard core tests use `node:test` and `node:assert/strict`; keep them deterministic and free of browser, hardware, wallet credentials, and network services.
- New browser and live integration tools belong in ignored `packages/extension/tests/.local/`. Keep their builds and evidence under ignored `output/`; existing V2 Playwright paths remain available during this limited migration.
- Do not reintroduce the standalone Vite E2E server, `e2e.html`, or mocked `chrome.*` APIs for wallet flows.
- Do not add standalone test pages or separate test-only UI implementations for screenshots or state construction.
- Prefer a real extension user journey that exercises the MV3 service worker, extension storage, packaged WASM, and `chrome-extension://` popup.
- When a UI state cannot be reached deterministically, test its behavior at the lowest reliable layer or use an explicit opt-in live integration test.
- Test builds must go to `packages/extension/e2e-dist/`. They must not modify production `dist/` or release zip files.
- Failure screenshots, traces, and Playwright metadata belong in the root `e2e-output/` directory.
- Screenshots produced for user review must remain available for the rest of the turn in which they are presented. Do not delete them in that turn; stale review screenshots may be cleaned at the start of a later turn immediately before producing a replacement set.
- Public-service checks are opt-in:
  - `LIVE_INTEGRATION=1` enables live ZNS tests.
  - `LIVE_LENDING_SDK=1` enables the live RHEA SDK oracle test.
  - `ANALYTICS_E2E=1` enables the live analytics collector test.
- Every reusable test wallet must be registered in `docs/mutil-chain/operations/test-wallet-registry.md`. Public, permanently unfunded vectors may be documented in the repository. Funded wallets must keep mnemonics, passwords, and private keys in separate absolute-path `0600` files outside Git tracking; `packages/extension/.env.test-wallets.local` stores only those file paths and non-secret metadata. Never persist broadcast-enabling flags in that local registry.
- The local 100-Wallet resource check is opt-in via `RESOURCE_BUDGET_E2E=1`. Run it with one worker and no retries; it waits for a stable Chrome process-tree RSS window before measuring the real V1 PBKDF2 and Multichain Argon2id path.
- Install the bundled browser with `pnpm --filter @noir-wallet/extension exec playwright install chromium` when needed.
- For bug fixes, add a regression test at the lowest layer that reproduces the defect. Use the real extension project when browser, MV3, storage, or lifecycle behavior matters.
- Keep Playwright retries at zero for extension tests; do not add browser-launch retry loops.
- The local `test:extension` script caps Playwright at four workers so real MV3 profiles, Zcash WASM, and password KDFs cannot scale with host CPU count and exhaust browser resources. The resource check remains single-worker.
- If Chromium or Chrome for Testing fails to launch, hangs, or aborts, do not start another test process immediately. First inspect the process tree and terminate only stale Playwright/Chrome for Testing processes that belong to the failed test run. Send `SIGTERM`, wait for exit, use `SIGKILL` only for the exact remaining PIDs, and verify that they are gone before retrying.
- Never use a broad `pkill` pattern that can terminate the user's regular Google Chrome or an unrelated browser session. Scope cleanup by executable, parent PID, test profile, and command line.
- Retry a failed browser launch at most once after cleanup. If the second launch fails, stop and report the failure evidence instead of repeatedly relaunching and consuming CPU.
- `tests/fixtures/v1.0.30-mainnet-software-golden.json` is an immutable compatibility artifact generated by the tagged V1 extension, not a hand-authored V2 fixture. Storage, credential, AccountManager, WASM persistence, or migration changes must keep both its logic integrity checks and real MV3 upgrade test passing.
- Do not regenerate or edit the Golden Profile from current V2 code. A replacement must name the released source tag and full commit, use only a test mnemonic with no funds, include the real encrypted envelope and WASM IndexedDB snapshot, and update the pinned integrity assertions in the same change.

## Global Network Mode

The published extension contains a global, mutually exclusive Mainnet/Testnet Mode.

- Mainnet is the migration default. The persisted `wallet_settings.networkMode` is authoritative after initialization.
- Switching mode is available only from Developer Settings. It stops sync, cancels unsigned approvals, disconnects dApps, locks the wallet, and reloads the extension before any target-network operation starts.
- The default build enables Zcash and EVM; Bitcoin, Solana, and NEAR remain visible as disabled Coming soon choices. Explicit chain feature flags are available for isolated verification profiles.
- Every enabled chain follows the same global mode. Default Testnet Mode shows Zcash Testnet and the released EVM test networks; explicitly enabled Bitcoin verification profiles use Testnet3. Mainnet data is not mixed into Testnet Portfolio, Activity, dApp, RPC, or explorer surfaces.
- Zcash WASM databases, account caches, and transactions remain partitioned by network. Public account metadata retains both network projections; secrets are not duplicated.
- Chain RPC/explorer settings are persisted per global mode.
- Every released chain supports named custom RPC endpoints. Saved RPC lists live in the optional `chainEndpointSettings.savedRpcEndpoints` field; `overrides` selects the active endpoint. The background validates network identity before saving. A selected custom Zcash endpoint is fixed and does not use registry failover.
- Managed RPC pools are loaded from `https://rpc.zknoir.com/v1/rpc-endpoints` and cached locally. `src/config/rpc-endpoints.ts` contains one bundled default per chain and network for use when neither the remote registry nor its cache is available; do not duplicate managed pools in the extension. Auto is the default and switches among attested managed endpoints on endpoint failures. EVM Auto clients read the latest pool at the start of each request, including registry updates received after startup; an in-flight request keeps its original pool. A manually selected RPC is fixed. The registry source lives in `packages/rpc-registry/src/registry.ts`; its scheduled monitor currently probes Zcash endpoints only.
- `NETWORK_MODE=testnet` and `[Testnet] Noir Wallet` remain only for isolated Playwright/live-test build profiles. They are not a second production release package.
- `zcash_switchNetwork` and SDK `switchNetwork()` remain deprecated; dApps cannot change the wallet's global mode.

Chain metadata and bundled RPC defaults live in `packages/extension/src/config/`. Bitcoin/Zcash CAIP-2 IDs are shared through `src/core/chains/registry/chain-ids.ts` so metadata does not depend on the product registry. Managed RPC endpoint lists live in the RPC registry. Do not duplicate endpoint values in business logic.
Global network mode and active explorer preferences are resolved in `src/lib/`; chain endpoint validation, capability policy, and per-chain runtime catalog selection live in `src/core/chains/`; registry fetching, managed endpoint selection, RPC preference storage, and failover live in `src/infrastructure/chains/`. Asset-source mapping rules live in `src/core/prices/`, password and balance rules in `src/core/wallet/`, and Zcash fee derivation in `src/core/zcash/`. Keep `src/config/` limited to bundled values, configuration parsing, and simple accessors.

## Extension Structure

```text
packages/extension/
├── manifest.config.ts
├── vite.config.ts
├── index.html
├── public/
├── src/
│   ├── background/       # Service worker, dApp handling, sync and monitors
│   ├── content-script/   # Provider injection and page bridge
│   ├── core/
│   │   ├── dapp/
│   │   ├── services/     # Lending, Intents and external integrations
│   │   ├── wallet/       # Account manager and secure storage
│   │   ├── worker/       # Offscreen/worker client
│   │   └── zcash/
│   ├── lib/              # IndexedDB, analytics, async and shared utilities
│   ├── offscreen/        # Offscreen host
│   ├── popup/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── provider/
│   ├── store/            # Zustand stores
│   └── types/
└── tests/
```

## UI Conventions

- Popup viewport: 375 × 600 pixels.
- dApp approval window: 375 × 632 pixels.
- Use theme variables from `src/popup/index.css`; current primary color is `#00d18a` and background is `#12121c`.
- Use existing components from `src/popup/components/` before introducing new primitives.
- Use `cn()` for conditional classes.
- Preserve flex `min-h-0`, shrink behavior, and footer visibility when working on full-height layouts.
- Verify popup layout at the configured viewport and avoid unnecessary vertical scrolling.
- Treat `docs/mutil-chain/design/ui-design-system.md` as the Figma-to-code visual baseline for multichain work.
- Production theme tokens and reusable components take precedence over legacy Figma hardcoded colors, fonts, and 344 × 588 canvas dimensions.
- Keep one filled primary action per screen. Selection controls use a dark card with a subtle primary border/tint and a non-color selection marker; they must not compete with the primary CTA.
- Use Jost for product UI and DM Mono for addresses, hashes, and precise machine-readable values. Do not add a legacy Figma font dependency without an explicit brand decision.
- Before implementing a Figma-driven screen, inspect its structure and screenshot. After implementation, compare it at 375 × 600 or 375 × 632 and run the relevant real MV3 browser flow.
- Put experimental Figma work in a clearly named `CODEX REVIEW` Section, preserve the original design, and do not treat an unapproved review copy as the source of truth.

### React Component Boundaries

- Keep `.tsx` components focused on rendering, ephemeral UI state, React lifecycle wiring, and delegating user events. A component must not become the owner of reusable business rules merely because the result is consumed by that screen.
- Move stateless parsing, validation, normalization, sorting, filtering, grouping, calculations, capability decisions, status/error mapping, and request-model construction into `core/`, `lib/`, `popup/services/`, or a dedicated adjacent `.ts` model module.
- `useMemo` and `useCallback` are not architecture boundaries. If their body can run without React state setters, refs, DOM/browser handles, or hook lifecycle, extract that body into a named pure function and leave only memoization or event wiring in the component.
- Do not make one component import business or presentation rules from another component file. Shared rules belong in a non-React module and both components should import that module directly.
- Consolidate duplicated chain, asset, account, transaction, and error-mapping rules at the first shared layer. Do not copy equivalent decision trees into multiple pages.
- Long asynchronous page flows may coordinate state transitions, cancellation, dialogs, signing, and navigation in the component or a dedicated hook. Their pure input validation, request derivation, response parsing, and lifecycle-state mapping must still be separate from that orchestration.
- Small JSX-only render helpers and trivial one-line display formatting may remain colocated. Do not create abstractions that only rename markup or hide component-specific layout.
- Before finishing a component change, inspect the touched component and related screens for substantial React-independent blocks. Extract them before handoff, then run type checking and the verification appropriate to the affected behavior.

## State, Persistence, and Security

### Zustand and Storage

Important persisted store keys include:

- `wallet_state`: wallet metadata and current wallet/account pointers.
- `wallet_deleted_ids`: durable deletion markers that prevent stale extension contexts from restoring removed wallets. Retained wallet metadata reads, writes, and deletions use the shared Web Lock in `src/lib/wallet-metadata-storage.ts`; persist metadata removal before clearing credentials. `wallet_deleted_records` retains non-secret account IDs until credential and cache cleanup finishes, allowing interrupted deletion to resume.
- `account_data`: account balance, sync, and portfolio caches. The background owns persisted balances and sync state; extension pages mirror background balances and persist only changed portfolio snapshots for existing accounts. Cache writes merge under a shared Web Lock. Persist account metadata removal before deleting its cache so stale pages cannot restore it. Transaction arrays are persisted separately in IndexedDB.
- `wallet_settings`: user settings.
- `swap_preferences`: swap preferences.
- `seed_<walletId>`: encrypted wallet credential data.

The `zcash-wallet-db` IndexedDB database stores WASM wallet snapshots, transaction history, and sync journal data. Treat schema/version changes as migrations and preserve wallet credentials.

### Security Boundaries

- Never log seed phrases, passwords, private keys, session key material, or decrypted wallet data.
- Wallet secrets use PBKDF2 with 100,000 iterations and AES-GCM encryption.
- Session credentials belong in `chrome.storage.session`, not persistent local storage.
- Validate dApp authorization and account binding for every sensitive request.
- Keystone and Ledger Zcash accounts use their vendor-specific PCZT transaction flows. Message signing and lending identity methods are unsupported for both. Capabilities for other chains must be explicitly supported by the corresponding hardware adapter.

## Async and Concurrency Patterns

Use helpers from `src/lib/async-utils.ts` rather than ad hoc polling or duplicate promises.

- `DedupPromise` shares one in-flight operation among concurrent callers.
- `ReadyFlag` represents an asynchronously satisfied prerequisite.
- Preconditions should use `ensure*` names and remain idempotent.
- Scope deduplication keys by wallet/account when operations can run independently.
- Always clean up timers, listeners, worker requests, and abort controllers.
- Do not add fixed sleeps to hide initialization races. Wait on the actual readiness signal.

## Transaction Lifecycle

Local transaction state is persisted per network, wallet, and account.

- Zcash broadcast completion means the transaction was built, broadcast, and recorded locally. UI completion must not wait for post-broadcast catch-up sync.
- `pending` means the origin transaction or relay is still being observed.
- `relay_confirmed` is an intermediate state only when another destination-chain transaction must still be confirmed.
- For outbound `supply` and `swap`, an Intents `SUCCESS` result is final and maps to `success`.
- For `withdraw` and `claim`, relay success maps to `relay_confirmed` until the destination Zcash transaction is confirmed.
- Status recovery must be idempotent and must not downgrade a terminal status because of stale polling results.

Use `src/lib/cross-chain-transaction.ts` as the shared source of truth for cross-chain completion semantics.

## Lending and Swap

- Lending data is account-scoped. Concurrent Home and Lending refreshes must share the same in-flight request.
- Do not add unconditional startup delays. Surface cached state immediately and begin refresh in the background.
- Swap entry loads only the selected source and destination chain catalogs. Load other catalogs progressively when their asset selector opens, and refresh balances only for the selected source chain.
- RHEA/Intents and public RPC latency are external dependencies; distinguish their latency from wallet initialization latency with logs and measurements.
- Supply and swap submit the Zcash leg first, then monitor the cross-chain deposit/relay status.
- Quote binding data used to monitor a transaction must be persisted with the local transaction record.

## dApp Provider and SDK

The content script injects `window.noirwallet.zcash`. The SDK wraps its request interface.
The EVM bootstrap in `public/early-evm-provider.js` announces at `document_start`; the full MAIN-world provider later attaches to that same provider object. Keep the bootstrap synchronous in production and HMR builds so dApps can restore their saved wallet during page initialization.

| RPC method                     | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `zcash_getAccounts`            | Silent connected-account query; returns `null` when unavailable              |
| `zcash_requestAccounts`        | Opens authorization and returns the primary account plus authorized accounts |
| `zcash_getAddresses`           | Returns primary transparent and shielded addresses                           |
| `zcash_getBalance`             | Returns primary/requested balance plus authorized account balances           |
| `zcash_getPublicKey`           | Returns a public identity key for the requested signing mode                 |
| `zcash_sendTransaction`        | Opens approval and sends a transaction                                       |
| `zcash_signMessage`            | Opens approval and signs a message                                           |
| `zcash_shieldFunds`            | Opens approval and shields transparent funds                                 |
| `zcash_getTransactionHistory`  | Returns on-chain and locally pending transaction history                     |
| `zcash_checkLendingMcaAccount` | Detects the lending MCA and signing mode                                     |
| `zcash_switchNetwork`          | Deprecated; always errors                                                    |

`getBalance().available` is the wallet's selectable shielded balance after a standard fee reserve, excluding pending funds; it is not a destination-specific post-fee Max. Use `getMaxTransfer()` with the same destination, memo, funding source, and fee tier as the send. Do not assume `total` or `shielded` is fully spendable; see `packages/extension/src/core/wallet/balance-summary.ts` and `packages/extension/src/config/wallet.ts`.

The multi-account SDK result keeps top-level primary-account fields for compatibility and includes an `accounts` array. Consult `packages/sdk/src/chains/zcash/types.ts` before changing response shapes.

## WASM Package Workflow

Do not edit or commit nested Rust source as part of the top-level repository.

Follow the [WASM package update procedure](./docs/release-workflow.md#wasm-package-updates) for explicit local builds and dependency-upgrade PRs. V2's two sync commands rebuild their pinned sources and write the complete packages with integrity manifests; they do not copy an existing `pkg/`. Ordinary wallet builds and merges use committed artifacts and do not synchronize WASM or amend commits.

Commit the complete updated engine package and its `wasm-integrity.json` together, including Zcash support files when present. Never ship TypeScript bindings without the matching JavaScript loader and `.wasm` binary.

## Release Workflow

The complete operational runbook is in `docs/release-workflow.md`.

- `packages/extension/package.json` is the extension version source of truth.
- `CHANGELOG.md` is the source of truth for production GitHub Release notes. Before building a production candidate, add exactly one non-empty `## [version]` section matching the extension version.
- V2 pull request pushes run read-only core checks. Add the `preview` label to request one development artifact for the current PR head; the trusted reporter removes the label when the build request starts, so another package requires reapplying it. Repository PR previews require `RHEA_SWAP_ACCESS_TOKEN` for Swap; fork previews receive no repository secrets.
- Run the trusted manual release workflow from `main` with mode `beta` and `source_ref=v2` (or an exact V2 source ref) to prepare a V2 Beta. The release build requires `RHEA_SWAP_ACCESS_TOKEN`; development PR artifacts are not Beta candidates.
- A `v2` push or tag does not publish an extension. Production candidate acceptance and publication use the separate trusted workflows on `main`.
- The extension build verifies both packaged WASM integrity manifests. Browser and live tests are local tools, not release gates. Each V2 release contains one ZIP for runtime Mainnet/Testnet Mode and `SHA256SUMS`.
- Chrome Web Store submission is currently manual; the workflow does not contain store credentials or an automated submission step.

### User-Facing Release Notes

`packages/web/public/changelog.json` contains the concise release notes shown inside the extension after an update. These are separate from the developer-oriented `CHANGELOG.md`.

- Add an entry matching the extension version before release.
- Give each meaningful, user-visible feature its own bullet.
- Give an important user-visible fix its own bullet, but combine multiple small fixes into one concise reliability or polish bullet.
- Let the number of bullets follow the meaningful changes in the release; do not pad or truncate the notes to a fixed count.
- Exclude internal refactors, tests, CI changes, dependency updates, and implementation details unless they materially affect users.
- Keep the copy plain, specific, and user-friendly. The runtime schema currently permits 1–8 bullets of at most 120 characters each so the popup remains readable.

Do not change release behavior based only on this summary; verify both the V2 PR workflow and the trusted manual workflow on `main` before editing CI.

## Implementation Rules

- Read relevant code, configuration, tests, and Git status before modifying files.
- Base conclusions on code, command output, or authoritative sources. Mark unverified assumptions explicitly.
- Fix root causes instead of hiding symptoms with delays or UI-only fallbacks.
- Keep changes scoped. Preserve unrelated user changes in a dirty worktree.
- Use the existing package manager, architecture, utilities, and naming conventions.
- Keep TypeScript strict. Avoid unjustified `any`, non-null assertions, and unsafe casts.
- Validate runtime data at system boundaries.
- Handle Promise rejection, timeouts, cancellation, resource cleanup, and concurrent calls explicitly.
- Do not add dependencies when platform APIs or existing packages solve the problem.
- Do not create compatibility branches for removed behavior unless the requirement explicitly demands them.
- Search with `rg` or `rg --files` first.
- Use `apply_patch` for manual file edits.
- Do not overwrite, reset, or delete unrelated changes.
- Code comments and public API JSDoc must be in English and explain why, not restate what the code does.

## Verification

Match verification to risk:

- For documentation-only changes, check formatting, changed links and references, and consistency with implementation sources. Run broader tests or builds only when the changed documentation requires them.
- Run focused regression tests while iterating.
- Run `pnpm test` for committed core behavior and public contract changes.
- Use `test:logic` for the existing Playwright logic suite and `test:extension` locally when browser, storage, MV3 lifecycle, service worker, or WASM packaging behavior matters.
- Run extension type checking and a production build for extension changes.
- Confirm production builds contain no test harness.
- Run broader workspace checks when public SDK types or shared packages change.
- Never claim a test passed unless its command completed successfully.
- If a test cannot run, state the reason and remaining risk.

## Git and Review Conventions

- Branches created by Codex use the `feat/` prefix unless the user specifies another name.
- Commit and pull-request titles use Conventional Commits: `feat(scope): subject`, `fix(scope): subject`, and similar.
- Commit messages and PR titles are in English.
- Do not add AI attribution, generated-by text, or AI co-author trailers.
- Before handoff, review for root-cause correctness, dead code, unnecessary abstraction, type safety, error handling, concurrency, security, preserved user changes, and leftover debug artifacts.

## Debugging

- Popup: right-click the extension icon and inspect the popup.
- Background: open the service worker inspector from `chrome://extensions`.
- History proxy and token-discovery HTTP requests originate in the Background service worker; inspect its Network panel to see them. Popup-only network inspection does not include these requests.
- Offscreen/worker: inspect `chrome-extension://<extension-id>/src/offscreen/index.html`.
- Storage: inspect `chrome.storage.local`, `chrome.storage.session`, and the `zcash-wallet-db` IndexedDB database from an extension context.
- Worker logs are forwarded to the background console with a `[Worker ...]` prefix.

Network-backed behavior can depend on wallet RPC, Zcash JSON-RPC, ZNS, RHEA, and NEAR Intents availability. Do not describe a network failure as an SDK defect without isolating the failing layer.
