# Contributing

This repository contains the Noir Wallet extension, SDK and example, website, documentation, and supporting packages. Contribute SDK changes in `packages/sdk/` through this repository. The Rust/WASM source is maintained separately; this repository tracks built packages and their integrity files.

Start with the [README quick start](./README.md#quick-start). Keep changes scoped, describe the behavior changed in your pull request, and report the checks you ran. Update the authoritative documentation when behavior or setup changes.

Use synthetic data or published test vectors. Do not put real recovery phrases, private keys, passwords, wallet exports, or sensitive transaction data in issues, pull requests, fixtures, or logs. Report vulnerabilities through the private channel in [SECURITY.md](./SECURITY.md).

## Licensing

Wallet contributions are provided under the [root license](./LICENSE), including its scheduled Apache License 2.0 grant. Contributions under `packages/sdk/` remain under the SDK's [MIT license](./packages/sdk/LICENSE). Preserve notices and licenses for third-party material.

## Development Practice

Read the affected code, configuration, tests, and Git state before editing. Use existing modules and conventions, keep TypeScript strict, validate external input, and handle rejection, cancellation, and resource cleanup. Prefer a focused fix over a new dependency or parallel implementation. Public comments and API documentation use English.

Add behavior tests for core rules, public contracts, security boundaries, and regressions likely to recur. Keep standard wallet core tests in the flat `packages/extension/tests/*.core.test.mjs` suite with Node's test runner; they must be deterministic and need no browser, network, hardware, or wallet credentials. Do not add source-text assertions or tests that only mirror implementation wiring. Existing tracked Playwright logic and real-extension tools remain available for focused local checks, not standard CI gates. Put new browser and live integration tools under ignored `packages/extension/tests/.local/`; do not expand tracked Playwright tests or dependencies.

## Verification

Run checks that match the change and report both results and omissions. Documentation-only work needs formatting, link, and source consistency checks, not a full build. Root `pnpm test` covers wallet core behavior; SDK tests run separately. For extension behavior, run focused regressions, then core tests, extension type checking, and a default build. Verify that a distributable build excludes test harnesses. For browser, storage, service-worker, or WASM behavior, check the actual isolated MV3 extension; do not treat a mocked page as wallet acceptance.

Keep browser test builds in `packages/extension/e2e-dist/` and screenshots, traces, and logs in ignored root `e2e-output/`, separate from release packages. Use existing opt-in flags for live-service tests and hardware checks; send real transactions only in user-authorized scenarios. Report checks blocked by missing hardware or credentials. Reusable fixtures follow the [test-wallet registry](./docs/mutil-chain/operations/test-wallet-registry.md); never print or commit funded credentials.

## Pull Request Targets

Target `main` for V1 maintenance and `v2` for V2 development. Only PRs targeting `v2` receive the `v2` version label; changing the target to `main` removes it. V1 PRs have no version label. Other labels such as `bug`, `enhancement`, and `documentation` are unaffected.

When a fix is needed in both versions, open one pull request from each target branch and link them to each other. Use English Conventional Commit titles and describe the behavior and verification relevant to that version.

Pull requests changing extension code, tests, WASM, or related build inputs run **Extension CI**. Its development ZIP is not a release candidate; see [V2 preview downloads](./docs/release-workflow.md#routine-previews) for the current process.

For SDK changes, follow the [SDK contribution checks](./packages/sdk/CONTRIBUTING.md). Root `pnpm test` covers the wallet core suite separately.

Maintainers review pull requests and verify affected wallet flows before merging. Browser, hardware, and real transaction checks require the relevant environment or device; report any checks that could not be run.
