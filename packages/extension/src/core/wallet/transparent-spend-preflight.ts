import type { ZcashBalance } from '@/types'

interface TransparentSpendCore {
  syncSessionSetup(): Promise<void>
  getBalance(): Promise<ZcashBalance>
}

/**
 * Refreshes chain-tip and transparent UTXO state immediately before selecting inputs.
 * A prior sync only proves that this state was fresh at that sync's tip.
 */
export async function prepareTransparentSpend(
  core: TransparentSpendCore,
  _amount?: string
): Promise<ZcashBalance> {
  await core.syncSessionSetup()
  return core.getBalance()
}
