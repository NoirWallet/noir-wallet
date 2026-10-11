# Contributing

This repository contains the Noir Wallet extension, SDK, website, documentation, and supporting packages. Contribute SDK changes here; its [package guide](./packages/sdk/CONTRIBUTING.md) lists the focused checks. The Rust/WASM source is maintained separately; this repository tracks its built package and [lock file](./wasm-package.lock.json).

Start with the [README quick start](./README.md#quick-start). Keep changes scoped, and include a short description of the behavior changed and the checks you ran when opening a pull request. Run the relevant type check, build, and tests described in the [project verification guide](./AGENTS.md#verification). Documentation changes should update the existing authoritative page described in [documentation governance](./AGENTS.md#documentation-governance).

Do not include real user or production recovery phrases, private keys, passwords, wallet exports, or sensitive transaction data in issues, pull requests, test fixtures, or logs. Use published test vectors or synthetic values in fixtures. Report a security vulnerability through the private channel in [SECURITY.md](./SECURITY.md).

## Pull Request Targets

Target `main` for V1 maintenance and `v2` for V2 development. Only PRs targeting `v2` receive the `v2` version label; changing the target to `main` removes it. V1 PRs have no version label. Other labels such as `bug`, `enhancement`, and `documentation` are unaffected.

When a fix is needed in both versions, open one pull request from each target branch and link them to each other. Use English Conventional Commit titles and describe the behavior and verification relevant to that version.

## Review and Acceptance

Contributors own self-testing and regression tests for core behavior or defects. Pull-request CI runs core tests, type checking, and mainnet/testnet extension builds. Maintainers review the change and verify affected wallet flows before merging; hardware changes require verification by someone with the device. Documentation and cosmetic changes only need their relevant checks.

Release owners review the selected source and verify production candidate ZIPs before manually promoting that exact build. Chrome Web Store submission uses the same accepted mainnet ZIP. Follow the [release runbook](./docs/release-workflow.md); CI success alone does not establish browser, hardware, or real-transaction acceptance.
