# Analytics Event Reference

Event names and page IDs are defined in [constants.ts](../packages/extension/src/lib/analytics/constants.ts). [policy.ts](../packages/extension/src/lib/analytics/policy.ts) filters event options, [payload.ts](../packages/extension/src/lib/analytics/payload.ts) builds the collector payload, and [client.ts](../packages/extension/src/lib/analytics/client.ts) sends it. This reference does not replace the [privacy policy](../packages/docs/content/docs/privacy-policy.mdx).

## Reporting

| Property     | Current behavior                                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build scope  | Production Mainnet builds, excluding local browser-verification builds; see [vite.config.ts](../packages/extension/vite.config.ts).                                                                                                                              |
| Collector    | `POST https://datareport.rhea.finance/v1/events/common` with `{ "data": "<encrypted string>" }`. The plaintext is a JSON array of event objects.                                                                                                                 |
| Encryption   | AES-128-CBC, PKCS#7, Base64; the key and IV use the first 16 bytes of the configured password.                                                                                                                                                                   |
| Batching     | The background service worker flushes after 2 seconds or at 20 events, keeps at most 200 queued events, retries failed uploads after 15 seconds, and drops the current batch after the third consecutive failure. Collector business rejections are not retried. |
| Channels     | Google Analytics receives the event name and allowed `params`. The custom collector receives the full filtered payload. Page views use GA `page_view` and collector `show_page`.                                                                                 |
| User control | **Share Google Analytics** defaults to on. Turning it off stops GA requests and clears the GA session. Collector reporting, its queued events, and the per-install anonymous identifier remain.                                                                  |

## Collector Fields And Privacy Boundary

| Field                                         | Meaning                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_id`, `chain`                         | Fixed values `noir_wallet` and `zcash`.                                                                                                     |
| `wallet_address`                              | Collector compatibility field set to `anon_<uuid>`, a random per-install identifier shared with the GA client ID; never a wallet address.   |
| `page_id`                                     | `noir_<route>`; background events use `noir_background` and dApp RPC events use `noir_dapp`. The full list is `PAGE_IDS` in `constants.ts`. |
| `timestamp`                                   | Event time in milliseconds, assigned when the event is raised.                                                                              |
| `extra`                                       | JSON string of allowed event metadata, with empty fields omitted.                                                                           |
| `input_amount`, `output_amount`, `usd_amount` | Collector wire fields that can hold valid exact input, output, and estimated USD amounts. Invalid or absent values become empty strings.    |

The collector schema and `buildPayload()` support exact amounts, so the collector protocol must not be described as inherently amount-free. The current `sanitizeAnalyticsEvent()` path used by normal wallet reporting omits amount options before payload construction; those events therefore send empty amount fields. The policy also rejects wallet and recipient addresses, transaction hashes, dApp origins, raw errors, recovery phrases, private keys, passwords, UFVKs, memo contents, contact names, and signed messages. `params` and `extra` use event-specific allowlists. Check the policy and call path before changing any privacy claim.

`has_transaction: 1` marks a transaction-related call site; it does not establish broadcast or confirmation. Asset labels may accompany relevant events, subject to the policy's bounded format checks.

## Event Catalog

| Event                               | Trigger and permitted context                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `extension_installed`               | First installation.                                                                                   |
| `extension_updated`                 | Update; `previous_version`.                                                                           |
| `wallet_created`                    | Creation or import; `method` and optional `has_birthday_height`.                                      |
| `wallet_unlocked`                   | Successful password unlock; `from_dapp`.                                                              |
| `wallet_locked`                     | Lock; `reason`.                                                                                       |
| `show_page`                         | Route view; `page_id`. GA receives `page_view`.                                                       |
| `account_switched`                  | Account switch; `cross_wallet`.                                                                       |
| `address_copied`                    | Receive address copy; `address_type`, never the address.                                              |
| `send_submitted`                    | Send confirmation, including entry to hardware signing; ZEC label, `fee_tier` and `hardware`.         |
| `transaction_sent`                  | Successful send broadcast, including hardware flow; optional `hardware`, `funding_source` and `kind`. |
| `send_failed`                       | Send failure; bounded `funding_source`, `kind` or `phase`, never the raw error.                       |
| `shield_succeeded`, `shield_failed` | Shield broadcast or failure.                                                                          |
| `swap_quoted`                       | Quote received; asset labels and `direction`.                                                         |
| `swap_submitted`                    | Swap confirmed; asset labels, `direction` and `hardware`.                                             |
| `swap_initiated`                    | ZEC deposit broadcast; asset labels, `direction` and allowed token labels.                            |
| `swap_failed`                       | Deposit send failure; `direction`, never the raw error.                                               |
| `swap_completed`                    | Terminal cross-chain status; `status` and `action`.                                                   |
| `hardware_wallet_connected`         | Keystone QR pairing; `is_existing_wallet`. Also reports `wallet_created` with hardware method.        |
| `hardware_sign_failed`              | Hardware signing or broadcast failure; `kind` and `phase`.                                            |
| `dapp_connected`                    | Connection authorized; `account_count` and `source`, never the origin.                                |
| `dapp_disconnected`                 | Connection removed; no origin.                                                                        |
| `dapp_request_rejected`             | User rejects a request; allowed `method` category.                                                    |
| `dapp_transaction_sent`             | dApp transaction broadcast; ZEC label, `funding_source` and `hardware`.                               |
| `dapp_transaction_failed`           | Approved dApp transaction fails; bounded context, no origin or raw error.                             |
| `dapp_message_signed`               | Message signing approved; `signing_mode`, no origin or message body.                                  |

`transaction_sent`, `swap_initiated`, `hardware_wallet_connected`, `dapp_connected` and `dapp_transaction_sent` retain established GA names for report continuity. Swap `direction` is `zec_to_other` or `other_to_zec`.

## Verification

The local [analytics tests](../packages/extension/tests/analytics.test.mjs) cover encryption compatibility, field filtering, payload construction, preferences, batching, and retries without contacting the collector:

```bash
pnpm --filter @noir-wallet/extension test:logic
```

`ANALYTICS_E2E=1` enables an opt-in collector request when `CUSTOM_ANALYTICS_PASSWORD` is supplied. It sends a test event to the live service; a passing local test alone does not establish collector availability.
