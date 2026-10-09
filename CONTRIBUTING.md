# Contributing

This repository contains the Noir Wallet extension, website, documentation, and supporting packages. The SDK is a [separate Git submodule](./.gitmodules); contribute SDK changes in its own repository. The Rust/WASM source is maintained separately; this repository tracks built packages and their integrity files.

Start with the [README quick start](./README.md#quick-start). Keep changes scoped, describe the behavior changed in your pull request, and report the checks you ran. Follow the [project verification rules](./AGENTS.md#verification) for affected packages and update existing documentation when behavior or setup changes.

Use synthetic data or published test vectors. Do not put real recovery phrases, private keys, passwords, wallet exports, or sensitive transaction data in issues, pull requests, fixtures, or logs. Report vulnerabilities through the private channel in [SECURITY.md](./SECURITY.md).

Maintainers review pull requests and verify affected wallet flows before merging. Browser, hardware, and real transaction checks require the relevant environment or device; report any checks that could not be run.
