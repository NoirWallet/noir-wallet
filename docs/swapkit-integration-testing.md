# SwapKit Integration: Manual Testing Guide

How to verify the Noir Wallet connector for SwapKit
(`NoirWallet/SwapKit` @ `feat/noir-wallet-zcash`, [upstream PR #1634](https://github.com/swapkit/SwapKit/pull/1634))
end to end. These are optional live checks of a separate repository, not Noir Wallet's core tests or release gates. The source assumptions below were checked against head `cae972f14310ed221f16bd214b85efdd5332e782`; recheck the connector before testing another revision. Use the [SDK reference](../packages/docs/content/docs/developers/provider-api.mdx) for the wallet contract.

## Prerequisites

- Chrome (or Chromium) with developer mode access to `chrome://extensions`
- A desktop Chrome session for the manual approval flows
- An explicitly authorized mainnet Noir Wallet extension build with a dedicated test wallet:
  - at least ~0.01 ZEC **in the shielded pool** (sell tests spend from it)
  - a small amount of BTC (or another supported asset) on hand for the buy test
- The Bun version selected by SwapKit's `packageManager` (`bun@^1.3.1` at the checked revision)
- The SwapKit fork checked out at the integration branch

## Environment setup

### 1. Build and load the extension

```bash
cd noir-wallet
pnpm install
pnpm build:extension          # mainnet build → packages/extension/dist
```

Load `packages/extension/dist` via `chrome://extensions` → "Load unpacked",
then create/import a wallet and confirm the shielded balance in the popup.

### 2. Build SwapKit and start the playground

```bash
git clone git@github.com:NoirWallet/SwapKit.git && cd SwapKit
git checkout feat/noir-wallet-zcash
bun install
bun run build:ci              # REQUIRED — see pitfalls below
cd playgrounds/vite
bun dev
```

Open the URL vite prints **including the `/SwapKit` base path**, e.g.
`http://localhost:3000/SwapKit`.

### Build and route troubleshooting

| Symptom                                                             | Cause                                                                                                                                  | Fix                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Failed to resolve import "@swapkit/wallet-extensions/noir-wallet"` | The playground aliases most `@swapkit/*` packages to `src`, but `@swapkit/wallet-extensions` resolves through its `dist/` build output | Run `bun run build:ci` at the repo root before `bun dev`              |
| Blank page / unrelated app / 404                                    | Port 3000 already in use → vite silently moves to 3001; the app is served under `/SwapKit`, not `/`                                    | Read the port from vite's startup output and keep the `/SwapKit` path |
| Production playground build fails                                   | Diagnose the external checkout's dependency and build output; the root has no `build-playground` script at the checked revision        | Do not report a dev-server run as a successful production build       |

## Test cases

Open DevTools (F12) on the playground tab before starting. Retain screenshots and only necessary, redacted console output locally under Noir Wallet's ignored `output/`. Never include credentials, decrypted wallet data, private keys, or recovery phrases.

### T1 — Provider detection

In the DevTools console:

```js
window.noirwallet // → { isNoirWallet: true, version: "...", zcash: {...} }
```

Pass: object exists with `isNoirWallet: true`. Fail: `undefined` → the
extension is not loaded or the content script did not inject.

### T2 — Connect

1. In the playground's wallet picker, select `NOIR_WALLET`
   (the Zcash chain is pre-selected; it is the only supported chain).
2. Click connect. The extension approval popup must open.
3. Approve.

Pass: the connected wallet shows the **transparent address** (`t1...`) and
wallet type `NOIR_WALLET`. Rejecting instead must surface an error in the
dApp, not hang.

### T3 — Balance

Click the balance refresh in the playground.

Pass: the ZEC balance equals the extension's **shielded spendable/available**
amount — NOT the transparent balance or the on-chain total of the `t1...` address. This balance is not a destination-specific post-fee Max; do not use it as a guarantee that an arbitrary exact amount will be accepted.

### T4 — Quote: sell ZEC (route check)

1. Request a quote for ZEC → BTC (any small amount within the shielded
   balance).
2. Inspect the returned routes and their `providers`.

Pass: at least one route with provider `NEAR` (NEAR Intents) exists and can
be selected. If only Maya/THORChain routes come back for this pair, executing
their transparent-address memo requests must be rejected by the extension (see T7) —
record which providers were offered either way; this feeds the upstream PR
discussion.

### T5 — Execute: sell ZEC via NEAR Intents

1. Select the NEAR Intents route from T4 and execute.
2. The extension approval popup must show the recipient (the Intents deposit
   address, `t1...`) and the exact amount.
3. Approve and wait.

Pass: a txid is returned to the dApp, the transaction appears in the extension's activity list, and the destination leg settles. A broadcast hash alone is not cross-chain completion. Keep full transaction hashes in local evidence only; redact them before sharing support material.

### T6 — Buy ZEC + the shielding gap

1. Execute a small BTC → ZEC swap with the connected wallet's address as
   destination.
2. After the swap settles, check balances.

Expected (by design, not a bug):

- The ZEC arrives at the **transparent** address — visible in the extension
  as transparent balance, and on a block explorer.
- The SwapKit-side balance (T3) does **not** increase.
- Open the extension and shield the funds manually (Shield action, user
  approval, using a supported software or Ledger account). After the shield transaction meets the wallet's confirmation and selection requirements, the
  SwapKit-side balance increases.

Pass: funds arrive, manual shield works, and the balance reflects the shielded
amount afterwards. This verifies the connector's transparent receive address
and shielded balance selection.

### T7 — Memo rejection (Maya route guard)

If T4 offered a Maya/THORChain route, execute it (small amount).

Pass: the dApp receives Noir Wallet's transparent-recipient memo validation error **before** transaction approval. The checked connector forwards the memo; it does not emit the old `wallet_noir_wallet_memo_not_supported` guard. No transaction must be created or broadcast.

### T8 — Sign message (optional)

In the DevTools console:

```js
await window.noirwallet.zcash.request({
  method: 'zcash_signMessage',
  params: ['swapkit test', {}]
})
```

For a software account, pass: approval popup, then `{ signature, pubkey, address, signingMode }`. Keystone and Ledger accounts must reject this unsupported identity method; their rejection is not a connector signing failure.

### T9 — Error paths

- Reject the approval popup during T5 → dApp shows an error, no tx created.
- Request a sell above the current selectable balance → the wallet must not create an unsupported spend. Record the observed rejection without assuming an unimplemented connector-specific error code.
- If a completion deadline expires after submission may have started, check Activity and the pending record before retrying; do not automatically resend.

## Reporting results

Record the tested connector commit and extension version in
[upstream PR #1634](https://github.com/swapkit/SwapKit/pull/1634), with:

- redacted results for T5/T6; share a full txid only through an explicitly authorized channel
- the provider list observed in T4 (which routes SwapKit actually returns
  for ZEC pairs)
- any console errors with stack traces
