# Contributing

This repository contains the Noir Wallet extension, website, documentation, and supporting packages. The SDK is a [separate Git submodule](./.gitmodules); contribute SDK changes in its own repository using its [contribution guide](https://github.com/NoirWallet/noir-wallet-sdk/blob/main/CONTRIBUTING.md). The Rust/WASM source is maintained separately; this repository tracks its built package and [lock file](./wasm-package.lock.json).

Start with the [README quick start](./README.md#quick-start). Keep changes scoped, and include a short description of the behavior changed and the checks you ran when opening a pull request. Run the relevant type check, build, and tests described in the [project verification guide](./AGENTS.md#verification). Documentation changes should update the existing authoritative page described in [documentation governance](./AGENTS.md#documentation-governance).

Do not include real user or production recovery phrases, private keys, passwords, wallet exports, or sensitive transaction data in issues, pull requests, test fixtures, or logs. Use published test vectors or synthetic values in fixtures. Report a security vulnerability through the private channel in [SECURITY.md](./SECURITY.md).

## Review and Acceptance

Contributors own self-testing and regression tests for core behavior or defects. Pull-request CI runs core tests, type checking, and mainnet/testnet extension builds. Maintainers review the change and verify affected wallet flows before merging; hardware changes require verification by someone with the device. Documentation and cosmetic changes only need their relevant checks.

Release owners verify candidate builds before tagging and the final production ZIP before Chrome Web Store submission. Follow the [release runbook](./docs/release-workflow.md); CI success alone does not establish browser, hardware, or real-transaction acceptance.
