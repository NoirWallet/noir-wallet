# SwapKit Integration: Status and Boundaries

## Verified Scope

As of October 3, 2026, [upstream PR #1634](https://github.com/swapkit/SwapKit/pull/1634) had not been merged. The connector source at head `cae972f14310ed221f16bd214b85efdd5332e782` included connection, balance, send, and message-signing adapters. That does not mean an upstream release includes the connector. Funding and hardware paths still require separate verification.

## Supported and Unsupported Paths in the Reviewed Connector

| Scenario                              | Status                                                          | Detail                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Connect and read balance              | Adapter present                                                 | Prefers the wallet's `available` balance, not the transparent address's total on-chain balance                   |
| Sell ZEC                              | Requires an external quote and live verification                | Connector forwards the send request; unspecified funding source defaults to shielded                             |
| Buy ZEC                               | Receives at the transparent address registered by the connector | The wallet can display the transparent balance, but the connector's available balance does not directly increase |
| Maya/THORChain transparent memo route | Unsupported by the current wallet                               | Connector forwards the memo; the extension rejects a memo on a transparent recipient address                     |
| Sign a message                        | Software accounts can request approval                          | Keystone and Ledger do not support this method                                                                   |

## Buying ZEC

Bought ZEC arrives at the **transparent address** registered by the connector. Noir Wallet can display that transparent balance, while the connector's `available` value represents selectable shielded funds. To spend those funds through the connector later, complete the supported Shield flow and wait for the confirmations required by the wallet. There is no guaranteed fixed wait time.

This describes the reviewed connector's address and balance choices. It does not establish a limitation across all SwapKit versions or Zcash routes.

## Verification

See the [manual test guide](./swapkit-integration-testing.md) for prerequisites, quotes, rejections, and funding checks. Route availability, actual settlement, and hardware behavior require separate verification. This summary does not establish that the connector is released or accepted.
