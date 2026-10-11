# Noir Wallet CI/CD and Release Workflow

This runbook covers V2 extension previews and the V2 inputs to the shared release process. The [V2 PR workflow](../.github/workflows/build-extension.yml) creates development inspection artifacts. Beta and production candidates are prepared by the trusted [manual release workflow on `main`](https://github.com/NoirWallet/noir-wallet/blob/main/.github/workflows/extension-release.yml). The [SDK workflow](../.github/workflows/sdk.yml) validates the SDK and example separately; the [documentation workflow](../.github/workflows/docs.yml) validates documentation without deploying it. Maintainers submit to the Chrome Web Store manually.

## Branches and Versions

- Feature and fix PRs merge into `v2`. PRs that change extension runtime, WASM, build inputs, or their test loaders run deterministic core tests and build a credential-free development extension. Tests, docs, and maintenance scripts alone do not start the wallet preview workflow.
- To prepare a V2 Beta, run **Prepare Extension Release** from the `main` workflow branch with mode `beta` and `source_ref=v2` (or a specific V2 source branch or full commit SHA). The workflow pins the selected source commit, builds it, and packages a Beta artifact. Publishing is controlled by that manual run's `publish_beta` input.
- The V2 workflow does not publish on `v2` pushes, tags, or workflow dispatch. Production candidates and publication use the separate trusted workflows on `main`; see the [shared release runbook](https://github.com/NoirWallet/noir-wallet/blob/main/docs/release-workflow.md).
- The production extension has one ZIP with runtime Mainnet/Testnet Mode. `NETWORK_MODE=testnet` is reserved for isolated local test builds, not a second release package.

## Verification and Build

The V2 PR preview runs:

```bash
pnpm install --frozen-lockfile
pnpm --filter @noir-wallet/evm-history-worker type-check
pnpm test
pnpm build:extension
```

`pnpm test` runs `packages/extension/tests/*.core.test.mjs` through Node.js's native test runner and the extension package's TypeScript loader. The extension build verifies both packaged Zcash and Multichain WASM integrity manifests and excludes E2E-only files. Existing `test:logic` Playwright logic tests and the `test:extension`, `test:release:default`, and `test:production-dist` browser tools remain available for local verification; they are not CI or release gates. `test:production-dist` uses test analytics/RHEA values and produces a local `dist/` that must not be published. For browser, MV3, storage, hardware, or network changes, maintainers should run the relevant local tools according to risk.

PR builds use `BUILD_CHANNEL=development`, receive no release secrets, and upload an explicitly named development artifact for inspection. They are not Beta or production candidates. Manual Beta builds use `BUILD_CHANNEL=beta` and require the release repository's `RHEA_SWAP_ACCESS_TOKEN`; missing values fail the build. Production builds additionally require `GA_API_SECRET` and `CUSTOM_ANALYTICS_PASSWORD`. The repository variable `EVM_HISTORY_API_ORIGIN` may override the default public History proxy origin; it must be a credential-free HTTPS origin without a path or query. The Worker API key stays in a Worker secret and is not passed into the extension build.

The public History proxy serves only the existing Ankr History, EVM token discovery, and icon services. The client selects History adapters across chains; other chains request their own data sources directly. See the [Activity architecture](mutil-chain/architecture/transaction-lifecycle.md#6-local-first-activity-merge) for routing and cache fallback, and the [History proxy deployment](#history-proxy-deployment) for Worker configuration and deployment checks.

The V2 package contains one ZIP for both runtime network modes, `SHA256SUMS`, release metadata, and a Release body. The PR workflow has read-only permissions and only uploads an Actions artifact. The trusted manual workflow packages Beta from the selected source commit and uses a separate write-scoped job when `publish_beta` is selected. Checkout steps use pinned Action SHAs with credential persistence disabled.

## Routine Previews

1. Open a PR against `v2` and confirm the development artifact passes the relevant local checks. Fork PRs receive no release credentials.
2. After source review, select `main` when opening **Prepare Extension Release** in Actions. Choose `beta` and set `source_ref` to `v2`, a reviewed but unmerged V2 branch, or its full commit SHA. Decide whether `publish_beta` should publish a GitHub prerelease; merging into `v2` is not required for Beta.
3. Check Mainnet and Testnet Mode separately in a real isolated MV3 extension. Run browser and external-service checks locally; the workflow does not run them.

There is no need to bump the version for each Beta. The manual run identity and source commit distinguish artifacts of the same version.

## Production Release

Production is prepared as a candidate and promoted through the trusted `main` workflows after acceptance. A V2 tag push no longer starts a build or publication. Follow the [shared release runbook](https://github.com/NoirWallet/noir-wallet/blob/main/docs/release-workflow.md) for the current candidate, acceptance, and promotion steps. Confirm the resulting single ZIP and `SHA256SUMS` before submitting that ZIP manually in the Chrome Web Store Developer Dashboard. Do not move a publicly released tag or reuse a published version number.

## Failure Recovery

- PR test/build failure: fix the source and update the PR. An existing development artifact is not a release candidate.
- Missing Beta build input: configure `RHEA_SWAP_ACCESS_TOKEN` in the trusted release repository and rerun the manual workflow. Do not publish the PR development ZIP as Beta.
- Incorrect selected source: start a new manual run against the intended V2 branch or full SHA; verify its source commit and checksums before publication.
- Production candidate or publication failure: follow the recovery procedure in the shared release runbook. Do not move an existing published tag or replace its package.

## SDK Example V1/V2 Coexistence

The existing public SDK repository continues to host the Example page: `main` serves V1 at the root path and the `/v1/` alias; `v2` serves `/v2/`. Both paths share the same web origin. The example source in this wallet repository is now maintained at `packages/sdk/example/`; its workspace CI builds it but does not deploy it. Before first-connection checks across versions, disconnect the wallet authorization and clear the Example's local state. The wallet extension release Workflow does not deploy or modify the SDK Example.

## History Proxy Deployment

The existing Worker source is `packages/evm-history-worker/`; its production hostname is `https://history-proxy.zknoir.com`. It serves the bounded Ankr methods used by the extension. Bitcoin, Solana, NEAR, and Blockscout providers remain direct client requests.

Configure `ANKR_API_KEYS` as a Worker runtime secret containing one to eight comma-separated keys. Do not commit the keys or pass them into the extension build. Use interactive input:

```bash
pnpm --filter @noir-wallet/evm-history-worker exec wrangler secret put ANKR_API_KEYS
pnpm --filter @noir-wallet/evm-history-worker deploy
```

Missing or invalid keys return service-unavailable errors. When using a Cloudflare Git build, select `v2` and the repository-relative `packages/evm-history-worker` root. A retry of an old build still uses that build's source revision.

Before enabling a new deployment, verify supported chains, native and token history, bounded or partial responses, account isolation, rate limiting, and failure fallback. A remote failure must retain existing cache and locally initiated transactions. Deployment and live-service verification are separate from local unit tests and extension builds.
