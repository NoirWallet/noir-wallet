export interface ActiveAccountIdentity {
  readonly walletId: string
  readonly accountId: string
}

export function resolveEffectiveActiveAccountIdentity(input: {
  readonly currentWalletId: string | null
  readonly currentAccountId: string | null
  readonly nativeAccount: ActiveAccountIdentity | null
}): ActiveAccountIdentity | null {
  if (input.currentWalletId && input.currentAccountId) {
    return Object.freeze({
      walletId: input.currentWalletId,
      accountId: input.currentAccountId
    })
  }
  return input.nativeAccount
    ? Object.freeze({
        walletId: input.nativeAccount.walletId,
        accountId: input.nativeAccount.accountId
      })
    : null
}
