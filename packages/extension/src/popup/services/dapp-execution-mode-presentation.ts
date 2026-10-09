import type { DAppPrivateExecutionSupportSummary } from '@/core/dapp/dapp-manager'

export function dappExecutionScopeLabel(summary: DAppPrivateExecutionSupportSummary): string {
  if (summary.connected === 0) return 'No dApps connected.'
  if (summary.mainOnly === 0) {
    return `Confidential works with ${summary.connected} connected ${summary.connected === 1 ? 'dApp' : 'dApps'}.`
  }
  if (summary.privateCapable === 0) {
    return `Connected ${summary.connected === 1 ? 'dApp uses' : 'dApps use'} Public only.`
  }
  return `Confidential works with ${summary.privateCapable} of ${summary.connected} dApps. ${summary.mainOnly} ${summary.mainOnly === 1 ? 'stays' : 'stay'} on Public.`
}
