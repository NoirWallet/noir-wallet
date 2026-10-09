# Noir Wallet CI/CD and Release Workflow

This runbook describes the current V2 extension release process. The [Build Extension Workflow](../.github/workflows/build-extension.yml) defines the actual rules. The [SDK Workflow](../.github/workflows/sdk.yml) validates the workspace SDK and example on affected pull requests and branch pushes without publishing them. The documentation site's [Documentation Workflow](../.github/workflows/docs.yml) validates documentation only; it does not deploy it. Maintainers submit to the Chrome Web Store manually.

## Branches and Versions

- Feature and fix PRs merge into `v2`. PRs run deterministic core tests without a browser or real credentials, type-check the EVM History Worker, and build the extension.
- A push to `v2`, or a manual Workflow run from that branch, produces a V2 preview prerelease. Public, non-fork repositories publish to their own GitHub Releases; private repositories and forks retain only the Actions build artifact.
- Production releases use a `v{version}` tag. It must match the version in `packages/extension/package.json` exactly and point to a commit contained in `origin/v2`. The existing V1 `v1.*` and V2 `v2.*` version ranges are separate.
- A production tag requires exactly one non-empty matching `## [version]` section in `CHANGELOG.md` and a valid matching entry of user-facing update notes in `packages/web/public/changelog.json`.
- The production extension has one ZIP with runtime Mainnet/Testnet Mode. `NETWORK_MODE=testnet` is reserved for isolated local test builds, not a second release package.

The Workflow creates preview tags in this format; do not create them manually:

```text
v{version}-beta.{UTC timestamp}.{short commit SHA}
```

For example, `v2.0.0-beta.202610091530.a1b2c3d`. A new run for the same `v2` ref cancels an unfinished earlier preview. Production-tag runs are not automatically canceled.

## Verification and Build

Every PR, preview, and production tag runs:

```bash
pnpm install --frozen-lockfile
pnpm --filter @noir-wallet/evm-history-worker type-check
pnpm test
```

`pnpm test` runs `packages/extension/tests/*.core.test.mjs` through Node.js's native test runner and the extension package's TypeScript loader. Existing `test:logic` Playwright logic tests and the `test:extension`, `test:release:default`, and `test:production-dist` browser tools remain available for local verification; they are not standard CI or release gates. `test:production-dist` uses test analytics/RHEA values and produces a local `dist/` that must not be published. For browser, MV3, storage, hardware, or network changes, maintainers should run the relevant local tools according to risk and report the results. Do not add real-wallet or external-service tests to the Workflow.

PR builds do not read release secrets. Preview and production builds for a public source repository use `BUILD_CHANNEL=beta` and `BUILD_CHANNEL=production`, respectively, and require the release repository's `RHEA_SWAP_ACCESS_TOKEN`. Production Mainnet builds also require `GA_API_SECRET` and `CUSTOM_ANALYTICS_PASSWORD`; missing values fail the build. Private repositories and forks perform only credential-free development builds, upload them as Actions artifacts for inspection, and do not create a Release. Those artifacts are not release candidates. The repository variable `EVM_HISTORY_API_ORIGIN` may override the default public History proxy origin; its value must be an HTTPS origin without credentials, a path, or query parameters. The Worker API key stays in a Worker secret and is not passed into the extension build.

The public History proxy serves only the existing Ankr History, EVM token discovery, and icon services. The client selects History adapters across chains; other chains request their own data sources directly. See the [Activity architecture](mutil-chain/architecture/transaction-lifecycle.md#6-local-first-activity-merge) for routing and cache fallback, and the [History proxy deployment](#history-proxy-deployment) for Worker configuration and deployment checks.

The build produces one `noir-wallet-v{tag without the v prefix}.zip`, such as `noir-wallet-v2.0.0.zip` for production. The Workflow uploads the ZIP, `SHA256SUMS`, and Release body as an Actions artifact. A separate `publish` job verifies SHA-256 before creating a Release in the current repository with `GITHUB_TOKEN`; only that job has `contents: write`. Beta is a prerelease and is not marked Latest; production is marked Latest. The Release points to a commit in the wallet repository, does not write to the SDK repository, and does not modify older betas.

Default Workflow permissions are read-only. Only the `publish` job explicitly requests `contents: write`. Checkout steps use pinned Action SHAs with credential persistence disabled. There is no separate cross-repository publishing token.

## Routine Previews

1. Create a feature or fix branch from the latest `v2`; complete the implementation and necessary local verification.
2. Open a PR against `v2`, confirm that core verification and the PR extension build pass, then review and merge it.
3. The `v2` push triggers a preview. Public source repositories provide the prerelease ZIP and SHA-256 checksum file on their own Releases page; private repositories and forks provide only a development artifact in Actions.
4. Check Mainnet and Testnet Mode separately in a real isolated MV3 extension. Run browser and external-service checks locally; the release Workflow does not run them.

There is no need to bump the version for each preview. The timestamp and commit distinguish multiple previews of the same version.

## Production Release

1. In a separate PR, update the version in `packages/extension/package.json`, the single matching version section in `CHANGELOG.md`, and the user-facing update notes in `packages/web/public/changelog.json`. Confirm the version has not been published.
2. Merge into `v2`, then run `pnpm test` and `pnpm build:extension`. Also verify the production build with actual production build inputs in a controlled environment. Run relevant real-extension checks locally according to the changes.
3. After acceptance, create an annotated tag from the latest `v2` commit:

```bash
git switch v2
git pull --ff-only
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
```

4. Confirm that the Prepare, Verify, Build, and Publish Actions jobs succeed. In this repository's Releases, inspect the tag, release notes, single ZIP, and `SHA256SUMS`. Download them and run `sha256sum --check SHA256SUMS`.
5. Upload the same production ZIP to the Chrome Web Store Developer Dashboard, check its version, permissions, and description, then submit it for review or staged release. Store publication is not automated.

Do not move a publicly released tag or reuse a published version number.

## Failure Recovery

- PR or preview test/build failure: fix it and submit again. A new `v2` commit generates a new preview tag.
- Production-tag verification failure: correct the version or release notes in a new PR, then select an unused version tag. If the tag is not on `v2`, merge the code into `v2` first.
- Infrastructure failure for a correct tag: if the release content has not changed, rerun the failed Actions job. An existing Release skips duplicate creation, but the artifact SHA-256 is still verified.
- Incorrect production package already published: stop promotion and fix it in a new patch release. Do not move the old tag or replace its package.

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
