import type { OneClickViewer } from './one-click-order'

export interface OneClickQuoteOptions {
  readonly viewer: OneClickViewer | null
  readonly signal?: AbortSignal
}

export function requestOneClickQuote<Result>(
  endpoint: string,
  quote: Readonly<{ dry: boolean } & Record<string, unknown>>,
  request: (url: string, init: RequestInit) => Promise<Result>,
  options: OneClickQuoteOptions
): Promise<Result> {
  const viewer = quote.dry ? null : options.viewer
  if (viewer === undefined) throw new Error('1Click quote owner must be specified')
  return request(`${endpoint}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...quote,
      user: viewer?.walletAddress,
      userChainFamily: viewer?.chainFamily
    }),
    signal: options.signal
  })
}

export function matchesOneClickQuoteViewer(
  echoed: Readonly<Record<string, unknown>>,
  viewer: OneClickViewer | null
): boolean {
  const { user, userChainFamily } = echoed
  return (
    (user === undefined ||
      (typeof user === 'string' &&
        (viewer?.chainFamily === 'evm'
          ? user.toLowerCase() === viewer.walletAddress.toLowerCase()
          : user === viewer?.walletAddress))) &&
    (userChainFamily === undefined || userChainFamily === viewer?.chainFamily)
  )
}
