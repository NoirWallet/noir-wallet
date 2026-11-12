import { MULTISIG_UI_CONFIG } from '@/config/multisig'

export function isMultisigUiEnabled(): boolean {
  return MULTISIG_UI_CONFIG.enabled
}

/**
 * The vault RPC handlers ship in every Worker bundle, but only a build with the multisig UI has a
 * caller for them. Background refuses the methods elsewhere so the surface stays unreachable.
 */
export function isVaultRpcBlocked(
  method: string,
  multisigUiEnabled: boolean = isMultisigUiEnabled()
): boolean {
  return method.startsWith('vault.') && !multisigUiEnabled
}
