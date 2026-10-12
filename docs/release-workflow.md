# Noir Wallet CI/CD and Release Workflow

This runbook describes extension verification in [build-extension.yml](../.github/workflows/build-extension.yml), manual Beta and production candidate builds in [extension-release.yml](../.github/workflows/extension-release.yml), and promotion in [publish-extension.yml](../.github/workflows/publish-extension.yml). The [documentation workflow](../.github/workflows/docs.yml) verifies the documentation site on relevant pull requests but does not deploy it. The [SDK workflow](../.github/workflows/sdk.yml) checks the SDK package and example from this workspace without publishing them. Website and voting Worker deployment are described in [Website and Voting Worker](#website-and-voting-worker). SDK npm publication and Chrome Web Store submission remain separate manual operations.

## Website and Voting Worker

The website at `https://www.zknoir.com/` keeps its existing Cloudflare Pages Git integration. It builds and publishes the independent `/frost` page with the rest of the website. The [Website Voting Worker workflow](../.github/workflows/web-vote.yml) deploys only `packages/web-vote/`, independently of Pages and wallet releases. Homepage traffic continues to use Pages; voting API routing is defined in the [Worker configuration](../packages/web-vote/wrangler.jsonc).

### One-Time Deployment Credentials

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add these repository secrets:

| Secret                  | Value                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account containing the website's zone and the voting Worker                |
| `CLOUDFLARE_API_TOKEN`  | A Cloudflare API token authorized to deploy the Worker and manage its routes in that zone |

Follow [Cloudflare's GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) to create a token using the **Edit Cloudflare Workers** template and restrict it to the intended account and website zone. See [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/) for Worker creation and route permissions. Store the token in Actions secrets, never in source files or frontend build variables. The configured hosts must use Cloudflare-proxied DNS for Worker routes.

### Automatic Deployment and Recovery

- Relevant pushes to `main` verify the Worker, test and build the voting client, then deploy the production Worker. The workflow's path filters define relevant changes.
- Pull requests run verification without deployment or access to the deployment credentials. Forks do not deploy.
- Manual runs can deploy from `main`; other branches only verify. Missing credentials fail deployment with a configuration error.
- Deployment uses the committed Wrangler configuration, including the Durable Object binding and migration. Existing stored votes are preserved; local test votes are not uploaded.
- Before deployment, the run's commit must still match current `main`. Rerunning an older workflow cannot replace a newer Worker deployment; start a new manual run from current `main` instead.
- The final step performs an anonymous, read-only request to the production API and validates its response against the client contract. It does not submit a production vote.

After pushing, check **Actions → Website Voting Worker** and the existing Pages deployment status. These are independent deployments; the page may publish before its API is ready. If credential or route setup fails, correct the relevant account, token, or DNS configuration and rerun the workflow from `main`. If the post-deployment API check fails, inspect the route and API response: the deployment may already have succeeded. Do not remove the Durable Object or reset votes to recover a failed deployment. For a code regression, revert the affected change on `main` and let the normal deployment workflow publish the correction. No production deployment is verified merely by a local dry run.

## Branches and Releases

- `main` is the integration branch. Submit features and fixes through short-lived pull request branches; `v2` is also an extension verification target.
- Pull requests targeting `main`, `v2`, or `release/**` build the selected source's extension packages when extension source, WASM, or build inputs change. Core checks run inside the same job. Documentation, tests, and release tooling alone do not start wallet CI; merging to `main` does not repeat the build. Automatic builds do not publish GitHub Releases.
- Manual Beta builds select a repository branch or full commit SHA without requiring a merge to `main`.
- V1 sources use separate mainnet and testnet ZIPs. V2 sources (extension version major 2 or later) use one multichain ZIP with runtime network selection. Both use the trusted manual workflow dispatched from `main`; select `source_ref=v2` for the current V2 source.
- A temporary `release/{version}` branch holds the reviewed production source. For a partial release or hotfix, start from a verified stable wallet source commit or a real production source tag, and cherry-pick only the intended changes. Historical migration tags are not usable source baselines; see [historical Releases](#historical-releases).
- Build a production candidate, accept its production ZIPs, then run a separate manual promotion. Promotion publishes those exact bytes and creates `v{version}` on the accepted source commit. Pushing a tag alone does not publish.
- The canonical `NoirWallet/noir-wallet` repository publishes wallet Releases even while private. Other public, non-fork repositories also publish to themselves. Forks and other private repositories retain Actions build artifacts without publishing Releases.
- Release workflow definitions must run from `main`; the source input selects wallet code independently. Keep the release branch until promotion completes, then merge applicable fixes back to integration branches and remove the temporary branch.

```mermaid
flowchart LR
  A["Feature / Fix PR"] --> B["Test artifacts: V1 two ZIPs / V2 one ZIP"]
  C["Selected branch / commit"] --> D["Manual Beta build"]
  D --> E["Optional GitHub prerelease"]
  F["Reviewed release/X.Y.Z source"] --> G["Manual production candidate build"]
  G --> H["Accept production ZIPs"]
  H --> I["Manual promotion of same ZIPs"]
  I --> J["GitHub Release + vX.Y.Z tag"]
  J --> K["Manual Chrome Web Store submission"]
```

### Preview and Beta labels

Automatic PR builds run when extension files outside tests and Markdown documentation, or root build inputs (`package.json`, lockfile, workspace config, Node version, TypeScript config, `.npmrc`, WASM lock, or license) match the path filters. Verification and building share one job; there is no standalone wallet validation run. V2 PR artifacts use the credential-free `development` channel and an explicit development artifact name; manual Beta artifacts use `beta`. PR metadata records the tested merge commit plus PR head and base commits. Download generated artifacts from **Actions → Build Extension**; their retention is seven days. For a tooling-only PR that needs a real ZIP check, use the manual Beta build with publication disabled. Ignored local UI tools and `output/` are not committed or release triggers.

Manual builds generate labels containing the run ID, attempt, and source commit; do not create them manually:

```text
v{version}-beta.{run ID}.{attempt}.{short source SHA}
v{version}-rc.{run ID}.{attempt}.{short source SHA}
```

Multiple Betas can use the same extension version. Manual runs are queued rather than cancelling an earlier build. Candidate labels identify Actions artifacts only; a candidate does not create a tag or Release. Manual build artifacts are retained for 30 days.

### Manual confirmation and production validation

Both manual workflows require repository write access and must be dispatched from `main`. Candidate construction requires confirmation of the full reviewed source SHA. Publication requires a separate dispatch with the accepted candidate run ID, attempt, and full source SHA. These are maintainer confirmations; the workflows do not enforce a second independent reviewer. GitHub environment required reviewers are not a prerequisite because that feature is unavailable on non-Enterprise private repositories. See [manual workflow permissions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) and [environment review availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments).

Candidate packaging and promotion enforce:

1. The source branch is `release/` plus the numeric version in `packages/extension/package.json`, and its resolved commit matches the manually confirmed full SHA.
2. The candidate uses production build settings and includes the expected packages: separate mainnet/testnet ZIPs for V1 or one multichain ZIP for V2.
3. `CHANGELOG.md` has exactly one nonempty `## [version]` section for that version.
4. `packages/web/public/changelog.json` has a matching entry accepted by the wallet's release-notes parser.

Promotion additionally verifies a successful candidate workflow dispatched from this repository's `main`, the exact run attempt and artifact ID, artifact metadata, every ZIP checksum, and unchanged release branch HEAD. A Beta or PR artifact cannot be promoted. Source code need not be contained in `main`. Existing production tags are never moved, and published assets are never overwritten.

## Workflow Stages

### Prepare

Resolve the selected branch once to a full source SHA and read its extension version and build profile. Candidates additionally confirm the source SHA and matching release branch. The same trusted preparation job maintains [associated PR version labels](../CONTRIBUTING.md#pull-request-targets) and reads recent commit history without executing selected-source code. Release notes include a folded commit log with up to 20 non-merge commits from the pinned source's most recent 100 commits, excluding subjects prefixed with `ci`, `fix(ci)`, `chore`, or `test`. Checkout the pinned source for testing and building. The trusted packaging job validates developer changelog and user-facing notes before exposing a candidate for acceptance.

### Verify

Every preview, Beta, and candidate build installs the frozen dependencies and runs deterministic core tests. V1 additionally verifies the vendored WASM lock:

```bash
pnpm install --frozen-lockfile
pnpm verify-wasm-pkg
pnpm test
```

`verify-wasm-pkg` checks the V1 vendored WASM provenance metadata, file inventory, sizes, and SHA-256 values against `wasm-package.lock.json`. V2 type-checks its EVM history Worker and verifies both packaged WASM engines through its existing build-surface gate after compilation. CI does not build or download WASM. Beta and production use the selected source's deterministic core tests. UI, Playwright, and hardware checks are local development activities, not automated release gates.

Before promotion, run `pnpm audit --prod` and `pnpm audit` against the frozen lockfile. Review each reported dependency path and affected API against the shipped extension bundles; apply compatible fixes and assess any remaining findings before release.

### Build

After verification, V1 builds both networks in order:

```bash
pnpm build:extension
pnpm build:extension:testnet
```

V2 runs only `pnpm build:extension`; that ZIP includes its runtime mainnet/testnet selection. `BUILD_CHANNEL` is `beta` for manual Betas and V1 PRs, `development` for V2 PRs, or `production` for candidates. Pull requests run tests and builds without publishing or receiving build secrets.

Build jobs keep read-only repository permissions. Manual builds upload their ZIPs to a fresh packaging job that executes tooling from the trusted workflow commit. It downloads ZIPs into a new directory outside the selected wallet checkout and reads only version and release-note data from that checkout. The final artifact contains the ZIP assets, `SHA256SUMS`, `release-metadata.json`, and `release-body.md`. Metadata binds the files to their source commit, build channel, repository, workflow commit, run ID, and attempt. V2 metadata identifies its single asset as `multichain`. Repository retention policies can shorten the requested retention.

V2 manual Beta and candidate builds require the existing `RHEA_SWAP_ACCESS_TOKEN` repository secret. The optional `EVM_HISTORY_API_ORIGIN` repository variable configures its history API and must satisfy V2's existing HTTPS-origin validation. These values are passed only to the selected V2 build. Missing required inputs fail the build; a development PR artifact cannot be published as Beta or promoted to production.

Production mainnet candidate builds require the repository secrets `GA_API_SECRET` and `CUSTOM_ANALYTICS_PASSWORD`. The workflow injects them only into the mainnet build step after the source SHA confirmation; a missing value stops the build. Local default builds, Beta builds, testnet builds, and local browser verification do not embed these values. For a local production mainnet build, supply the same environment variables through your shell and set `BUILD_CHANNEL=production`.

Analytics values embedded in the extension are visible to its users. They must not grant privileged server access or be relied on as confidential authentication. Rotate previously committed values before exposing repository history, and configure the replacements in repository secrets without committing them.

### Publish

The publish job runs in `NoirWallet/noir-wallet` regardless of visibility, and in other public, non-fork repositories. It downloads the exact artifact ID, validates provenance and checksums, and publishes to `github.repository`. Only publication jobs receive `contents: write`; they use the built-in `GITHUB_TOKEN`. Production promotion performs validation and publication in one job, executes no wallet source code, and performs no build. Releases in a private repository are visible only to people with repository access.

- Beta uses a prerelease and is not marked Latest. Its tag points to the wallet source commit that produced the ZIPs.
- Production creates `v{version}` at the accepted source SHA and is marked Latest. If that tag already exists, it must resolve to the same source commit. Earlier prereleases remain available.
- Production notes come from the matching `CHANGELOG.md` section. Each Release includes a source commit link, the ZIPs for its build profile, and `SHA256SUMS`.

V1 production assets are `noir-wallet-v{version}.zip` and `noir-wallet-v{version}-testnet.zip`; V2 has only the first asset. Candidate artifacts already use these filenames. Beta asset names include the Beta label. A promotion retry skips an existing Release only if its tag, all ZIP digests, and `SHA256SUMS` match the accepted candidate. GitHub's automatically attached source archives come from the wallet repository at the release tag.

### Historical Releases

The SDK is maintained in `packages/sdk/` but keeps its own version and npm publication process. For historical stable wallet Releases migrated from [the former SDK repository](https://github.com/NoirWallet/noir-wallet-sdk/releases), copy the binary assets byte-for-byte and link each original Release in the migration notes. Preserve wallet source commit links where the original notes provide them, pointing old `NoirWallet/noir-wallet` commit URLs to `NoirWallet/noir-wallet-private` with the same SHA; do not infer missing wallet source commits from the SDK Release target. Migration tags in this repository point to its initial commit (`5d7fcf4`); their source archives are not snapshots of the historical wallet source. This workflow does not modify those Releases. The wallet download and repository entry points are [wallet builds](https://zknoir.com/beta/versions) and [wallet source](https://zknoir.com/github). Website builds target `NoirWallet/noir-wallet` by default; see the [website build configuration](../README.md#build).

## WASM Package Updates

WASM source and releases are maintained in a separate repository. This wallet repository commits the complete web package at `packages/extension/src/lib/wasm-pkg/`. The root `wasm-package.lock.json` records the source commit and ref, build features, release artifact SHA-256 when available, and individual file hashes. Upstream releases do not automatically update the wallet. Ordinary builds and merges use the committed package without downloading, rebuilding, or synchronizing WASM; merges do not amend commits.

Prefer an immutable published archive with its SHA-256:

```bash
pnpm update-wasm-pkg -- \
  --repository https://github.com/NoirWallet/zcash-wallet-wasm \
  --commit <full-commit-sha> \
  --ref <release-tag> \
  --features <comma-separated-features> \
  --artifact-url <https-url> \
  --artifact-sha256 <sha256>
```

For local WASM builds, check out the desired upstream tag or full commit in the separate repository. Start with a clean source checkout, remove its old generated `pkg/`, and rebuild the complete web release package using that repository's build instructions and the features you will record below. Then adopt it explicitly:

```bash
pnpm update-wasm-pkg:local -- \
  --ref <tag-or-full-commit-sha> \
  --features <comma-separated-features>
```

The local importer rejects tracked or untracked source changes and a ref that does not resolve to the checkout's HEAD. It records the full commit and hashes of the imported files; it does not rebuild or prove that an existing `pkg/` came from that commit. Rebuilding after selecting the source ref is the developer's responsibility. Use `--source <checkout>/pkg` when the separate checkout is outside `packages/zcash-wallet-wasm/`.

Develop and test the extension against that package, then submit the lock file, complete generated package, and related extension changes in one PR. Include the upstream version, build features, and verification performed. Never submit only updated TypeScript bindings without their matching loader, binary, and support files. Generated package files are excluded from formatting to preserve their hashes.

`pnpm sync-wasm-pkg` restores only the locked package and rejects source commits or `pkg/` hashes that differ from the lock; it is not an upgrade command. Run `pnpm verify-wasm-pkg` after an update. Both local extension build commands also verify the package before compilation, and CI verifies it without access to the source checkout. Do not create feature-specific `pkg-voting` directories.

## Beta Procedure

1. Push the intended branch and open a pull request. Download its **Build Extension** artifact to test before merging.
2. For a distributable Beta, open **Actions → Prepare Extension Release → Run workflow** with the workflow branch set to `main`.
3. Select `mode=beta`, set `source_ref` to the intended repository branch or full lowercase 40-character commit SHA, and choose whether `publish_beta` should create a prerelease. Leave `confirm_sha` empty.
4. Check the resolved source SHA in the run summary. Download its artifact or published Beta ZIPs and test the affected flows. For V2 use `source_ref=v2` (or the intended V2 branch/full SHA); keep the workflow branch set to `main`.

No merge, version bump, or manually created tag is required for each Beta. Selecting a branch pins its HEAD for that run; later pushes do not change the built source.

## Production Procedure

### 1. Prepare and review the release source

Create a temporary `release/{version}` branch from the source you intend to ship. For a selective release, use the verified stable source commit or an actual production source tag, then cherry-pick the required fixes. Open a preparation PR for review; merging unrelated integration changes is not required.

1. Set a new version in `packages/extension/package.json`, for example `1.0.40`, and use branch `release/1.0.40`.
2. Add exactly one nonempty `## [1.0.40]` section to `CHANGELOG.md`.
3. Add the matching user-facing update entry in `packages/web/public/changelog.json`, following the [release notes rules](../AGENTS.md#user-facing-release-notes).

Review the exact diff against the stable baseline and run the relevant local checks. For V1:

```bash
pnpm test
pnpm build:extension
pnpm build:extension:testnet
```

For V2, run `pnpm test` and `pnpm build:extension`; there is no separate testnet build. Use the actual V2 version and corresponding `release/{version}` branch in the steps below.

### 2. Build and accept the production candidate

Open **Actions → Prepare Extension Release → Run workflow** from `main`. Select `mode=candidate`, set `source_ref=release/1.0.40`, and enter the full reviewed release branch HEAD in `confirm_sha`. `publish_beta` is ignored for candidates.

After all jobs succeed, download the final `noir-wallet-v1.0.40-rc.…` artifact, check `SHA256SUMS`, and validate both V1 network ZIPs or the single V2 multichain ZIP. Use the actual ZIPs, not a local rebuild or a previous Beta. Keep the run ID, attempt, and full source SHA from the run summary for promotion. See [review responsibilities](../CONTRIBUTING.md#review-and-acceptance).

### 3. Promote the accepted artifact

After acceptance, open **Actions → Publish Accepted Extension → Run workflow** from `main`. Enter the accepted `candidate_run_id`, `candidate_run_attempt`, and `confirm_sha`. This separate action is the production publication confirmation.

The workflow verifies the candidate's origin and current release branch before creating the GitHub Release and `v1.0.40` tag. It downloads and publishes the accepted ZIPs without rebuilding. Keep the source branch unchanged and present until publication completes.

### 4. Check publication

Confirm **Publish Accepted Extension** succeeded. In the wallet repository's Releases page, check the source tag/commit, Latest status, the expected ZIP assets, and release notes. Download `SHA256SUMS` beside the ZIPs and run `sha256sum --check SHA256SUMS` (or `shasum -a 256 --check SHA256SUMS` on macOS). Compare those hashes with the accepted candidate. Forks and private repositories other than `NoirWallet/noir-wallet` retain build artifacts only.

### 5. Submit to Chrome Web Store

Store submission is manual. Verify the production ZIP, `noir-wallet-v{version}.zip` (V1 mainnet or V2 multichain), from the GitHub Release matches the accepted candidate. Upload that same ZIP in Chrome Web Store Developer Dashboard, review the version, changed permissions, and release notes, then submit for review or staged rollout under the store configuration. Record the actual publication time after approval. Never upload the V1 `-testnet.zip` asset to the production store listing.

## Failure Recovery

- **Preview or Beta failure:** fix the selected branch and push again for PR artifacts, or dispatch a new Beta. For transient manual build failures, rerun all jobs so the artifact and publication use one matching run attempt; rerunning only Beta publication will reject artifacts from an older attempt. Keep unusable published Betas for traceability.
- **Candidate validation or build failure:** correct the release source and notes, review its new SHA, and build a new candidate. For an infrastructure retry, rerun all build jobs and accept the resulting attempt before promotion.
- **Release branch advanced or was removed:** restore the accepted branch HEAD only if it is still the intended source, or build and accept a new candidate. Promotion rejects a candidate whose branch no longer matches.
- **Candidate artifact expired:** build and accept a new candidate. Promotion never reconstructs the old package from source.
- **Publication failure:** retry promotion with the same accepted run, attempt, and SHA while its artifact remains available. A completely published Release with identical asset digests is left unchanged. If a partial or conflicting Release exists, inspect it before recovery; the workflow will not overwrite it automatically.
- **Incorrect published Release:** stop promoting it and release a new patch version. Do not reuse or move the old tag.

For an urgent fix, start a new `release/{patch-version}` branch from the verified stable wallet source, apply the fix and regression test, update the version and both release notes, then review, build, accept, and promote it independently of unfinished integration changes. Merge the applicable fix back to `main` and `v2` afterward. An extension already published in the browser store cannot be rolled back in place; publish a new patch version.

## Pre-Release Checks

- [ ] The release source and its diff against the stable baseline have been reviewed.
- [ ] Extension version is new and unpublished.
- [ ] Changelog has exactly one matching, nonempty version section.
- [ ] User-facing update notes match the version and visible changes.
- [ ] The manual candidate workflow succeeded for the confirmed source SHA.
- [ ] Mainnet and testnet production candidate ZIPs passed acceptance.
- [ ] The recorded run ID, attempt, and SHA identify that accepted artifact.
- [ ] The release branch is unchanged through promotion.
- [ ] The separate manual promotion succeeded.
- [ ] Production tag points to the accepted release source commit.
- [ ] Wallet source tag/commit, both GitHub Release ZIPs, checksums, and release notes were checked.
- [ ] Final acceptance used the production ZIP intended for Chrome Web Store.
- [ ] Mainnet ZIP was submitted to Chrome Web Store.

Chrome Web Store upload and approval, SDK npm publishing, candidate construction confirmation, and production promotion remain manual. Website and voting Worker operations follow [Website and Voting Worker](#website-and-voting-worker). Do not add unverified secret names or third-party publication actions to the workflow.
