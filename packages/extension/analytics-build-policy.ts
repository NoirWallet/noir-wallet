export interface AnalyticsBuildContext {
  buildChannel: string
  isPlaywrightBuild: boolean
  networkMode: string
}

export function shouldEnableAnalyticsReporting({
  buildChannel,
  isPlaywrightBuild,
  networkMode
}: AnalyticsBuildContext): boolean {
  return buildChannel === 'production' && networkMode === 'mainnet' && !isPlaywrightBuild
}
