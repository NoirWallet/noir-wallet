# Error Message Reference

Shared classification and message mapping are defined in [errors.ts](../packages/extension/src/lib/errors.ts). Pages also have field validation and operation-specific feedback, so this is not a complete list of UI copy. The classifier uses the first matching rule in source order; check the classifier and call site for a specific result.

The “Retryable” column is the classifier's `retryable` flag. It does not mean every call site retries automatically.

## Network

| User message                                                         | Trigger                                     | Retryable |
| -------------------------------------------------------------------- | ------------------------------------------- | --------- |
| Network connection failed. Please check your internet and try again. | Connection failed; gRPC service unreachable | Yes       |
| Request timed out. The server may be busy — please try again.        | Request timeout                             | Yes       |
| Network error. Please check your internet connection.                | Network request error                       | Yes       |
| Could not reach the server. Please try again later.                  | Server unreachable                          | Yes       |
| Server is busy. Please wait a moment and try again.                  | Server rate limit                           | Yes       |
| Service is temporarily unavailable. Please try again shortly.        | HTTP 5xx                                    | Yes       |

## Wallet Engine

| User message                                                   | Trigger                                   | Retryable |
| -------------------------------------------------------------- | ----------------------------------------- | --------- |
| Wallet engine error. Please restart the extension.             | Wallet engine error or crash              | No        |
| Operation timed out. Please try again.                         | Engine operation timeout                  | Yes       |
| Wallet engine is not responding. Please restart the extension. | Repeated unresponsiveness                 | No        |
| Wallet engine crashed. Please restart the extension.           | Severe engine crash                       | No        |
| Your browser does not support this feature.                    | Browser lacks Web Worker support          | No        |
| Wallet is syncing. Please try again after sync completes.      | Blockchain sync in progress               | Yes       |
| Wallet state changed. Please retry the operation.              | Wallet state changed during the operation | Yes       |

## Passwords and Accounts

| User message                                                            | Trigger                                         | Retryable |
| ----------------------------------------------------------------------- | ----------------------------------------------- | --------- |
| Incorrect password. Please try again.                                   | Incorrect password                              | No        |
| Invalid password. Please try again.                                     | Invalid password                                | No        |
| Invalid recovery phrase. Please check and try again.                    | Malformed recovery phrase                       | No        |
| Account data conflict. Please re-import your wallet.                    | Account data does not match the recovery phrase | No        |
| Wallet is locked. Please unlock and try again.                          | Wallet locked                                   | No        |
| Wallet is initializing. Please wait a moment and try again.             | Wallet initializing                             | Yes       |
| Account is loading. Please wait a moment and try again.                 | Account loading                                 | Yes       |
| Account initialization timed out. Please restart and try again.         | Account initialization timeout                  | No        |
| No password set. Please set up your wallet first.                       | No password configured                          | No        |
| Wallet not found. Please create or import a wallet.                     | Wallet missing                                  | No        |
| No account available. Please select or create an account.               | No account available                            | No        |
| Failed to load wallet data. Please try unlocking again.                 | Wallet data load failed                         | No        |
| Cannot remove the last account. Each wallet needs at least one account. | Attempt to remove the only account              | No        |
| Too many failed attempts. Account temporarily locked.                   | Temporary lock after repeated password failures | No        |

The unlock page reports missing credentials, malformed credential data, and unlock failures separately. These cases do not increment the wrong-password counter. AES-GCM authentication failure cannot distinguish a wrong password from tampered ciphertext and is handled as password verification failure.

When the current wallet entry or its credentials are missing, the unlock page can check the entered password against other wallets and switch to one that unlocks. It does not delete the broken entry or require resetting the extension. This recovery does not run when the current credentials exist but the password does not match. Target-wallet verification for backup or password changes does not use it. If all usable credentials are missing, recovery requires the recovery phrase or hardware device.

## Transactions

| User message                                                                | Trigger                         | Retryable |
| --------------------------------------------------------------------------- | ------------------------------- | --------- |
| Insufficient balance for this transaction.                                  | Insufficient balance            | No        |
| Amount is too small to send.                                                | Below the minimum send amount   | No        |
| Invalid recipient address. Please check and try again.                      | Invalid recipient address       | No        |
| No transparent funds available to shield.                                   | No transparent funds to shield  | No        |
| Transaction timed out. Please check your transaction history and try again. | Transaction timeout             | No        |
| Failed to create transaction. Please try again.                             | Transaction construction failed | Yes       |

## dApp Connections

| User message                                                            | Trigger                                    | Retryable |
| ----------------------------------------------------------------------- | ------------------------------------------ | --------- |
| Invalid request parameters from the dApp.                               | Invalid dApp parameters                    | No        |
| Not authorized. Please connect the dApp first.                          | dApp not authorized                        | No        |
| No active connection. Please reconnect the dApp.                        | No active dApp connection                  | No        |
| Network switching is deprecated. Install the testnet extension instead. | dApp requests deprecated network switching | No        |
| Unsupported operation requested.                                        | Unsupported operation                      | No        |

## Hardware Wallets

| User message                                                    | Trigger                                | Retryable |
| --------------------------------------------------------------- | -------------------------------------- | --------- |
| This operation requires hardware wallet signing.                | Hardware signing required              | No        |
| This operation is not supported by hardware wallets.            | Unsupported hardware operation         | No        |
| Please unlock your wallet before adding a hardware wallet.      | Wallet must be unlocked before pairing | No        |
| No Zcash accounts found in the QR code.                         | QR code has no Zcash accounts          | No        |
| Unrecognized QR code format. Please scan a valid Zcash QR code. | Unrecognized QR format                 | No        |

## User Action

| User message               | Trigger                 | Retryable |
| -------------------------- | ----------------------- | --------- |
| Request cancelled by user. | User rejects or cancels | No        |

## Storage

| User message                                                        | Trigger                                  | Retryable |
| ------------------------------------------------------------------- | ---------------------------------------- | --------- |
| Wallet data is incomplete. Resync this wallet before sending again. | Missing or invalid wallet snapshot chunk | No        |
| Failed to save wallet data. Please try again.                       | Wallet data save timeout                 | Yes       |

On a transaction failure caused by an incomplete snapshot, the result page offers the existing Resync confirmation when the transaction record identifies one wallet and account on the active network and has no broadcast hash. If that record cannot identify the affected account, the page directs the user to select it and open its account details. Resync requires an unlocked wallet and a valid start height; it rebuilds the wallet snapshot by scanning from that height. The original storage error remains in diagnostics.

## ZNS Names

| User message                                  | Trigger          | Retryable |
| --------------------------------------------- | ---------------- | --------- |
| ZNS name not found.                           | Name not found   | No        |
| ZNS name resolution failed. Please try again. | Resolution error | Yes       |

## Fallback

| User message                                     | Trigger               | Retryable |
| ------------------------------------------------ | --------------------- | --------- |
| Original error text, or `Unknown error` if empty | No known rule matched | Yes       |

## Automatic Retry

Only operations that explicitly call `withRetry()` act on the retryable flag. The default is at most **3 attempts** (initial call plus 2 retries), with **1-second and 2-second** waits; callers can override the count and base interval. A non-retryable error or the final failure ends the operation. Other call sites may display the error directly or use their own recovery policy.

If a transaction has been broadcast or its outcome is unknown, check Activity and existing records before trying again. The flag does not authorize automatic rebroadcast. See the [transaction lifecycle rules](../AGENTS.md#transaction-lifecycle).

## Form Validation

These messages are shown directly for input validation and are not system errors:

- `Please enter your password`: empty password
- `Passwords do not match`: confirmation differs
- `Selected words do not match. Please try again.`: recovery phrase verification differs
- `Please agree to the Terms of Use`: terms not accepted
- `Please enter amount`: empty Swap amount
- `Please enter receive/refund address`: empty Swap address
