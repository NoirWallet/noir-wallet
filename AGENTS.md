# AGENTS.md - Noir Wallet Project Guidelines

This file is the canonical project guide for coding agents and contributors. `CLAUDE.md` points here instead of duplicating these instructions. Keep shared instructions here and update affected documentation according to the ownership below.

## Documentation Governance

These rules apply to documentation-only work as well as documentation affected by code changes.

### Ownership

| Content                                                  | Authoritative location                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Project overview and local development, test, and build  | [README.md](./README.md)                                                                                                       |
| AI work rules, architecture, and development constraints | `AGENTS.md`; `CLAUDE.md` only directs readers here                                                                             |
| Wallet guides and SDK integration/API explanations       | Source MDX under [packages/docs/content/docs/](./packages/docs/content/docs/)                                                  |
| SDK package installation and package-local quick start   | [SDK README](./packages/sdk/README.md)                                                                                         |
| Module-specific reference material                       | Existing topic documents such as [analytics events](./docs/analytics-events.md) and [error messages](./docs/error-messages.md) |
| Task-specific operations and recovery                    | [Release runbook](./docs/release-workflow.md) and existing task-specific operational guides under `docs/`                      |
| Developer release history and user-facing update notes   | [CHANGELOG.md](./CHANGELOG.md) and `packages/web/public/changelog.json`, respectively; retain their distinct audiences         |
| Decisions and historical context                         | Existing audit, research, design, and retired-workflow records under `docs/`; not current usage guides                         |

Documentation explains verified implementation facts; code, configuration, and public types remain the implementation sources of truth. Check SDK contracts against `packages/sdk/src/chains/zcash/types.ts` and the extension's provider implementation. The documentation site's generated output is not a separate maintenance source. Classify existing topic documents by their content, not their filename or age, before treating them as current guidance.

### Maintenance Rules

1. Search existing documentation before adding a document. Update the existing authoritative location by default. Create a document only for a clear audience, durable purpose, and independent ownership that no existing location can reasonably accommodate; do not create empty documents, placeholder directories, or templates.
2. Keep temporary analysis, task progress, implementation diaries, and delivery summaries in chat or an existing temporary workspace. Add lasting records only when the user requests them, an established project workflow requires them, or they have clear long-term maintenance value.
3. Maintain each fact in one authoritative location. Elsewhere, link rather than duplicate configuration, steps, rules, or explanatory passages. For generated content, maintain its source instead of manually editing the output.
4. Verify current-state descriptions against code, configuration, tests, and actual execution results. Do not infer features, defaults, interfaces, limits, or support. State what could not be verified; never claim verification, completion, or support without evidence.
5. Check documentation impact with every code change. Update the authoritative documentation when usage, public interfaces, configuration, defaults, architecture boundaries, or development and deployment steps change. If there is no documentation impact, do not manufacture a documentation edit.
6. Update obsolete guidance or retire it from current usage paths, updating replacement links so contradictory guides do not coexist. Preserve historical decisions, retrospectives, and audits, clearly distinguished from current guidance. Ask before changing material whose ownership or retention value is unclear.
7. Remove repetition, code narration, irrelevant background, and development-process detail. Preserve prerequisites, key behavior, limits, failure feedback, and recovery paths needed to complete the reader's task; brevity alone is not the goal.
8. Follow the existing document's language and formatting conventions. Do not introduce bilingual documents or bulk translation on your own. Keep existing bilingual counterparts consistent when their meaning changes.

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
- Node.js native test runner for committed core tests

### SDK

- TypeScript 5.9
- tsup output in ESM, CJS, and declaration formats
- Public exports from `@noir-wallet/sdk` and `@noir-wallet/sdk/chains/zcash`

### Website

- React 19, TypeScript 5.8, Vite 7, Tailwind CSS 4

### Tooling

- pnpm 10 workspace
- Node.js 22 in CI
- GitHub Actions builds mainnet and testnet extension artifacts

Use versions from the relevant `package.json` as the source of truth when this summary becomes stale.

## Common Commands

Use the [README quick start](./README.md#quick-start) for dependency installation, development, build, type-check, and core test commands. Verify scripts against the relevant `package.json` before running them. Specialized WASM and release procedures remain in their existing sections and runbook.

## Automated Testing

Committed tests use `node:test` and `node:assert/strict`. Each package owns one flat `tests/` directory and its own `test` command. Root `pnpm test` explicitly aggregates the extension, RPC registry, website signup client, and signup Worker core suites; private tooling in the independent WASM checkout is excluded. Shared runner helpers live in `scripts/`, and the source loader uses the tested package's existing TypeScript compiler. No additional test framework is required. Run tests on Node.js 22 or newer after `pnpm install`.

```text
packages/
├── extension/tests/              # Wallet core tests
├── rpc-registry/tests/           # RPC service core tests
├── web/tests/                    # Website signup contract tests
└── web-vote/tests/               # Signup API and persistence tests
scripts/
├── run-core-tests.mjs            # Package-scoped native test runner
├── register-test-loader.mjs      # Source loader registration
└── typescript-test-loader.mjs    # Package-scoped TypeScript source loader
```

### Test Rules

- Only add tests for core business rules, public contracts, security boundaries, and defects likely to regress. Do not add one-off source-text assertions, implementation-wiring checks, or tests that merely restate constants and component markup.
- Prefer a small behavior-focused test that survives refactoring. Test observable outcomes, not source text, UI copy, component markup, or implementation wiring.
- Standard tests must be deterministic and must not require a browser, network service, wallet credentials, hardware, or real transactions. Inject external dependencies at the lowest reliable boundary.
- Keep one flat `tests/` directory per tested package and one local output root, `output/`. Do not scatter tests beside production source files or create separate unit/integration/e2e directories. A root `tests/` directory is reserved for genuine cross-package integration tests and must not be created when none exist. Add a new package to the root test aggregation only when its core suite meets these rules.
- UI tests, live integration checks, and Playwright configuration are local development tools only. Keep them under ignored `/packages/extension/tests/.local/`; do not commit them, add Playwright to workspace dependencies, or include them in standard tests, CI, or release gates.
- Local browser verification should exercise the real isolated MV3 extension, not a standalone test UI or mocked wallet page. Keep its builds in `output/extension/` and all screenshots, traces, videos, reports, and logs under ignored `output/`. Use `output/browser/runs/` for disposable Playwright run output, separate from retained evidence. Never overwrite production artifacts or create separate output roots.
- For bug fixes, add a core regression test at the lowest layer that reproduces the defect. Perform browser or hardware verification locally when the defect requires it, and report those results separately from the standard suite.

## Build-Time Network Separation

Mainnet and testnet are separate builds selected by `NETWORK_MODE` at build time.

- Mainnet is the default.
- Testnet builds use `NETWORK_MODE=testnet` and the name `[Testnet] Noir Wallet`.
- Separate extension IDs isolate Chrome storage, IndexedDB, and runtime state.
- There is no runtime network switch. `zcash_switchNetwork` and SDK `switchNetwork()` are deprecated and must direct users to install the testnet extension.
- Mainnet supports automatic or fixed wallet RPC selection; testnet uses its fixed configuration.
- ZeroIndexer is a separate, default-enabled broadcast preference under Security & Privacy, with an independent node management page. Auto uses only managed ZeroIndexer nodes; a fixed selection uses one managed or custom node. Transactions containing Orchard try its configured endpoints in order, then fall back to the ordinary wallet RPC if every ZeroIndexer attempt fails, including in fixed mode. Other transactions use the ordinary wallet RPC directly. Node preferences are stored per network in `zero_indexer_nodes_v1`, separately from the synchronization RPC settings. Probe results indicate reachability and priority, not the actual successful broadcast provider.

Current network endpoints and chain IDs live in `packages/extension/src/config/networks.ts`. Do not duplicate endpoint values in business logic.

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
└── tests/                # Flat core tests; local UI tooling is ignored
```

## UI Conventions

- Popup viewport: 375 × 600 pixels.
- dApp approval window: 375 × 632 pixels.
- Use theme variables from `src/popup/index.css`; current primary color is `#00d18a` and background is `#12121c`.
- Use existing components from `src/popup/components/` before introducing new primitives.
- Use `cn()` for conditional classes.
- Preserve flex `min-h-0`, shrink behavior, and footer visibility when working on full-height layouts.
- Verify popup layout at the configured viewport and avoid unnecessary vertical scrolling.

## State, Persistence, and Security

### Zustand and Storage

Important persisted store keys include:

- `wallet_state`: wallet metadata and current wallet/account pointers.
- `wallet_deleted_ids`: durable wallet deletion markers that prevent stale extension contexts from restoring removed entries. Wallet metadata writes and deletions use the shared Web Lock in `src/lib/wallet-metadata-storage.ts`; commit metadata removal before clearing credentials.
- `account_data`: cached balances and sync state. Transaction arrays are persisted separately in IndexedDB.
- `wallet_settings`: user settings. RPC updates and store writes use the shared Web Lock in `src/lib/wallet-settings-storage.ts`.
- `swap_preferences`: swap preferences.
- `seed_<walletId>`: encrypted wallet credential data.

The `zcash-wallet-db` IndexedDB database stores WASM wallet snapshots, transaction history, and sync journal data. Treat schema/version changes as migrations and preserve wallet credentials.

### Security Boundaries

- Never log seed phrases, passwords, private keys, session key material, or decrypted wallet data.
- Wallet secrets use PBKDF2 with 100,000 iterations and AES-GCM encryption.
- Session credentials belong in `chrome.storage.session`, not persistent local storage.
- Validate dApp authorization and account binding for every sensitive request.
- Hardware wallets use Keystone or Ledger PCZT flows for transactions. Message signing and lending identity methods are not supported for either. Funding-source restrictions are defined in `packages/extension/src/lib/hardware-capabilities.ts`.

### Extension Logging

These rules apply to all code under `packages/extension`:

- Treat `logger.log`, `logger.info`, `logger.warn`, and `logger.error` as exported diagnostics. Every call is persisted on-device and may be downloaded and shared with Noir Support, including production builds.
- Use `logger` only for durable, user-shareable technical events that help reconstruct startup, wallet readiness, sync, RPC, Worker, and transaction lifecycle failures. Log the stage and outcome, not request or wallet payloads.
- Never include recovery phrases, private keys, passwords, credentials, decrypted wallet data, signatures, memos, addresses, balances, amounts, dApp origins, complete transaction hashes, or raw request/response objects in `logger` messages. Sanitization is defense in depth, not permission to log sensitive data.
- Pass `walletId` and `accountId` through the existing optional `logger` arguments when correlation is needed; do not interpolate identifiers into the message. The diagnostic pipeline fingerprints those arguments before persistence.
- Use `console.log` for temporary, local-only debugging details that must not appear in exported diagnostics. Production builds remove ordinary `console.log` calls. Plain `console.*` calls are never a substitute for durable support diagnostics.
- Secrets such as recovery phrases, private keys, passwords, session credentials, and decrypted wallet data must not be printed through either `logger` or `console` under any circumstances.
- Keep raw errors or payload details in `console` only when they are safe for the local extension inspector. Send a precise but privacy-safe error message to `logger`; do not fall back to generic text when the safe underlying error is actionable.
- Preserve actionable error reasons, RPC methods, error codes, causes, and technical recovery context in Help-exported diagnostics. Pass exceptions as the fourth `logger` argument, after optional wallet/account IDs; the shared pipeline retains diagnostic error fields and sanitizes them without copying request/response payloads. Worker and offscreen errors must use the same error projection and serialization. Do not replace unfamiliar errors with a fixed stage or whitelist category.
- Do not add another diagnostic logger, persistence path, or runtime message for logging. Extend the existing `src/lib/logger.ts` serialization and storage path when the shared behavior must change. Worker code must use the existing Worker log-forwarding bridge.
- Avoid logs in render paths, activity handlers, timers, polling loops, or other high-frequency code unless a state transition or terminal failure occurred.

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

Use `packages/extension/src/lib/cross-chain-transaction.ts` as the shared source of truth for cross-chain completion semantics.

## Lending and Swap

- Lending data is account-scoped. Concurrent Home and Lending refreshes must share the same in-flight request.
- Do not add unconditional startup delays. Surface cached state immediately and begin refresh in the background.
- RHEA/Intents and public RPC latency are external dependencies; distinguish their latency from wallet initialization latency with logs and measurements.
- Supply and swap submit the Zcash leg first, then monitor the cross-chain deposit/relay status.
- Quote binding data used to monitor a transaction must be persisted with the local transaction record.

## dApp Provider and SDK

The content script injects `window.noirwallet.zcash`. The SDK wraps its request interface.

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

`getBalance().available` is the wallet's selectable shielded balance, excluding pending funds; it is not a destination-specific post-fee Max. Use `getMaxTransfer()` with the same destination, memo, and funding source as the send. Do not assume `total` or `shielded` is fully spendable; see `packages/extension/src/core/wallet/balance-summary.ts` and `packages/extension/src/lib/funding-source.ts`.

The multi-account SDK result keeps top-level primary-account fields for compatibility and includes an `accounts` array. Consult `packages/sdk/src/chains/zcash/types.ts` before changing response shapes.

## WASM Package Workflow

Do not edit or commit nested Rust source as part of the top-level repository.

Follow the [WASM package update procedure](./docs/release-workflow.md#wasm-package-updates) for local builds, published artifact imports, and dependency-upgrade PRs. Ordinary extension builds and merges use the committed package without synchronizing WASM or amending commits. Local adoption requires a clean source checkout at the selected ref and a fresh build; the importer records commit and file hashes but does not prove source-to-binary correspondence.

Commit `wasm-package.lock.json` and the complete generated `packages/extension/src/lib/wasm-pkg/**` package together. Generated files are excluded from formatting so hooks cannot invalidate the locked artifact. Never ship TypeScript bindings without their matching loader, binary, and support files. Local extension builds and CI verify the vendored package without compiling or downloading WASM.

## Release Workflow

The complete operational runbook is in `docs/release-workflow.md`.

- `packages/extension/package.json` is the extension version source of truth.
- `CHANGELOG.md` is the source of truth for production GitHub Release notes. Before building a production candidate, add exactly one non-empty `## [version]` section matching the extension version.
- Pull requests targeting `main`, `v2`, and `release/**` produce preview artifacts when extension source, WASM, or build dependencies change. Core checks run inside the build job. V1 uses separate network ZIPs; V2 uses one multichain ZIP and credential-free development PR previews. Documentation, tests, and release tooling alone do not start wallet CI; pushes after merging do not repeat the build.
- Run `Prepare Extension Release` manually from `main`, selecting a repository branch or full commit SHA for Beta. Production candidates require a reviewed `release/{version}` branch and confirmation of its full source SHA; they use production build settings.
- Run `Publish Accepted Extension` separately after accepting the candidate ZIPs. It validates the candidate run, attempt, source SHA, current release branch, and checksums, then publishes the same ZIPs and matching `v{version}` tag without rebuilding. The source commit need not be merged to `main`.
- All build paths run the selected source's deterministic core tests and WASM integrity gates. V2 manual builds use the same `main` workflow with `source_ref=v2`; see the runbook for V2 build inputs. Browser verification is a separate local development activity, not an automated release gate.
- PR version labels are maintained during trusted manual build preparation; there is no separate label workflow. See the [contributor guide](./CONTRIBUTING.md#pull-request-targets).
- Wallet Releases use the source repository's tags and built-in `GITHUB_TOKEN`, with `contents: write` limited to publication. `NoirWallet/noir-wallet` publishes even while private; forks and other private repositories retain Actions artifacts only. The SDK is maintained in this workspace; its versioning and npm publication remain independent of wallet releases.
- Chrome Web Store submission is currently manual; the workflow does not contain store credentials or an automated submission step.

### User-Facing Release Notes

`packages/web/public/changelog.json` contains the concise release notes shown inside the extension after an update. These are separate from the developer-oriented `CHANGELOG.md`.

- Add an entry matching the extension version before release.
- Give each meaningful, user-visible feature its own bullet.
- Give an important user-visible fix its own bullet, but combine multiple small fixes into one concise reliability or polish bullet.
- Let the number of bullets follow the meaningful changes in the release; do not pad or truncate the notes to a fixed count.
- Exclude internal refactors, tests, CI changes, dependency updates, and implementation details unless they materially affect users.
- Keep the copy plain, specific, and user-friendly. The runtime schema currently permits 1–8 bullets of at most 120 characters each so the popup remains readable.

Do not change release behavior based only on this summary; verify the extension workflows, `scripts/extension-release*.mjs`, and affected preview reporting code before editing CI.

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
- Use ignored local browser tools for popup, storage, MV3 lifecycle, or browser-specific behavior; never add them to the standard suite or CI.
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
- Offscreen/worker: inspect `chrome-extension://<extension-id>/src/offscreen/index.html`.
- Storage: inspect `chrome.storage.local`, `chrome.storage.session`, and the `zcash-wallet-db` IndexedDB database from an extension context.
- Worker logs are forwarded to the background console with a `[Worker ...]` prefix.

Network-backed behavior can depend on wallet RPC, Zcash JSON-RPC, ZNS, RHEA, and NEAR Intents availability. Do not describe a network failure as an SDK defect without isolating the failing layer.
