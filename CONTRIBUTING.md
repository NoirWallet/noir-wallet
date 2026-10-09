# Contributing

This repository contains the Noir Wallet extension, SDK and example, website, documentation, and supporting packages. Contribute SDK changes in `packages/sdk/` through this repository. The Rust/WASM source is maintained separately; this repository tracks built packages and their integrity files.

Start with the [README quick start](./README.md#quick-start). Keep changes scoped, describe the behavior changed in your pull request, and report the checks you ran. Follow the [project verification rules](./AGENTS.md#verification) for affected packages and update existing documentation when behavior or setup changes.

Use synthetic data or published test vectors. Do not put real recovery phrases, private keys, passwords, wallet exports, or sensitive transaction data in issues, pull requests, fixtures, or logs. Report vulnerabilities through the private channel in [SECURITY.md](./SECURITY.md).

## Pull Request Targets

Target `main` for V1 maintenance and `v2` for V2 development. Only PRs targeting `v2` receive the `v2` version label; changing the target to `main` removes it. V1 PRs have no version label. Other labels such as `bug`, `enhancement`, and `documentation` are unaffected.

When a fix is needed in both versions, open one pull request from each target branch and link them to each other. Use English Conventional Commit titles and describe the behavior and verification relevant to that version.

For SDK changes, follow the [SDK contribution checks](./packages/sdk/CONTRIBUTING.md). Root `pnpm test` covers the wallet core suite separately.

Maintainers review pull requests and verify affected wallet flows before merging. Browser, hardware, and real transaction checks require the relevant environment or device; report any checks that could not be run.
