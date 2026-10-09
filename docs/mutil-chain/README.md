# Multichain Maintenance Reference

The extension separates UI, Background orchestration, chain adapters, and wallet computation. See [project architecture](../../AGENTS.md#architecture), [network mode](../../AGENTS.md#global-network-mode), and [state and security](../../AGENTS.md#state-persistence-and-security) for the maintained boundaries.

Chain availability comes from the product registry, enabled feature flags, and runtime capabilities. A chain identifier or adapter alone does not establish that every wallet type supports every operation. Global Mainnet/Testnet Mode applies to all enabled chains; accounts, transactions, caches, RPC settings, and explorer selections remain partitioned by network.

## Reference Guides

- [Transaction lifecycle and Activity](architecture/transaction-lifecycle.md): local transaction ownership, lifecycle transitions, remote history, cache fallback, and reconstruction.
- [Confidential DeFi development](operations/private-defi-development.md): Main, private execution, abstract balances, configuration, and recovery.
- [UI design conventions](design/ui-design-system.md): production tokens, components, viewport sizes, and design-to-code review.
- [Test-wallet registry](operations/test-wallet-registry.md): public unfunded vectors, private fixture formats, and local verification boundaries.
- [Release runbook](../release-workflow.md): local versus release inputs, History proxy deployment, and artifact verification.

## Implementation Sources

- `packages/extension/src/core/chains/`: chain identifiers, product definitions, asset registry, and capability policy.
- `packages/extension/src/core/keyring/`: internal command protocol and wallet computation ports.
- `packages/extension/src/infrastructure/keyring/`: command clients and credential persistence.
- `packages/extension/src/core/transactions/`: scoped transaction graphs and lifecycle rules.
- `packages/extension/src/core/activity/` and `src/infrastructure/activity/`: Activity projections, aggregation, and supplemental history.
- `packages/extension/src/config/`: bundled values, parsing, and simple accessors. Managed RPC pools belong to the remote registry.

The public dApp API belongs to the independent [SDK](../../packages/sdk/README.md) and [published provider guide](../../packages/docs/content/docs/developers/provider-api.mdx). Internal plans and historical review records are kept outside this public reference.
