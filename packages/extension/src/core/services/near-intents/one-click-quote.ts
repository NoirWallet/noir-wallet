import { jsonRequestInit } from '@/lib/fetch-utils'
import type { OneClickChainFamily, OneClickViewer } from './one-click-order'

function quoteViewerFields(viewer?: OneClickViewer): {
  user?: string
  userChainFamily?: OneClickChainFamily
} {
  if (!viewer || viewer.signingMode === 'private') return {}
  return { user: viewer.walletAddress, userChainFamily: viewer.chainFamily }
}

export function requestOneClickQuote<Result>(
  endpoint: string,
  quote: Readonly<{ dry: boolean } & Record<string, unknown>>,
  request: (url: string, init: RequestInit) => Promise<Result>,
  options: { viewer?: OneClickViewer; signal?: AbortSignal } = {}
): Promise<Result> {
  return request(
    `${endpoint}/quote`,
    jsonRequestInit(
      { method: 'POST', signal: options.signal },
      { ...quote, ...quoteViewerFields(quote.dry ? undefined : options.viewer) }
    )
  )
}

export function matchesOneClickQuoteViewer(
  echoed: Readonly<Record<string, unknown>>,
  viewer?: OneClickViewer
): boolean {
  return Object.entries(quoteViewerFields(viewer)).every(
    ([key, expected]) => echoed[key] === undefined || echoed[key] === expected
  )
}
