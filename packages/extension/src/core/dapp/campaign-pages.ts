import { Caip25ProviderError } from './caip25'

export type CampaignScreen = 'shield'

interface CampaignDefinition {
  readonly origins: ReadonlySet<string>
  readonly screens: Readonly<Record<CampaignScreen, string>>
}

// Campaign pages only open a wallet flow; they receive no session, accounts, or wallet data,
// and the user still reviews every action in the wallet. Keep this separate from the
// auto-connect first-party policy, which grants account access.
const CAMPAIGNS: ReadonlyMap<string, CampaignDefinition> = new Map([
  [
    'shield-and-win-1',
    Object.freeze({
      origins: new Set(['https://noirwallet.pages.dev']),
      screens: Object.freeze({
        shield:
          '/transfer?entry=shield&provider=near-confidential&mode=public&from=public&to=shield'
      })
    })
  ]
])

const OPEN_CAMPAIGN_KEYS: ReadonlySet<string> = new Set(['campaign', 'screen', 'protocol'])

const CAMPAIGN_WALLET_ROUTES: ReadonlySet<string> = new Set(
  [...CAMPAIGNS.values()].flatMap(definition => Object.values(definition.screens))
)

/** True for the exact wallet routes campaign pages open, which a wallet tab keeps across unlock. */
export function isCampaignWalletRoute(route: string): boolean {
  return CAMPAIGN_WALLET_ROUTES.has(route)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Validates a `wallet_openCampaign` request from `origin` and returns the wallet route to open.
 * Rejects malformed parameters with -32602, an origin or campaign mismatch with 4100,
 * and an unknown screen with 4200.
 */
export function resolveCampaignOpenPath(params: unknown, origin: string): string {
  if (!isPlainRecord(params) || Object.keys(params).some(key => !OPEN_CAMPAIGN_KEYS.has(key))) {
    throw new Caip25ProviderError(-32602, 'Invalid campaign parameters.')
  }
  const { campaign, screen, protocol } = params
  if (
    typeof campaign !== 'string' ||
    typeof screen !== 'string' ||
    (protocol !== undefined && protocol !== 'near-confidential')
  ) {
    throw new Caip25ProviderError(-32602, 'Invalid campaign parameters.')
  }
  const definition = CAMPAIGNS.get(campaign)
  if (!definition || !definition.origins.has(origin)) {
    throw new Caip25ProviderError(4100, 'This site cannot open that campaign.')
  }
  if (!Object.prototype.hasOwnProperty.call(definition.screens, screen)) {
    throw new Caip25ProviderError(4200, 'That campaign screen is unavailable.')
  }
  return definition.screens[screen as CampaignScreen]
}
