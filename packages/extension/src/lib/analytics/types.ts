/**
 * Wire format expected by the collector API
 * (POST https://datareport.rhea.finance/v1/events/common).
 * The JSON array of these payloads is AES-128-CBC encrypted before upload.
 */
export interface AnalyticsEventPayload {
  chain: string
  event_name: string
  extra: string
  has_transaction: 0 | 1
  input_amount: string
  input_symbol: string
  input_token_code: string
  output_amount: string
  output_symbol: string
  output_token_code: string
  page_id: string
  project_id: string
  timestamp: number
  usd_amount: string
  wallet_address: string
}

/** Call-site options for tracking an event (all fields optional). */
export interface TrackOptions {
  /** Sent to GA as event params and merged into custom `extra` */
  params?: Record<string, unknown>
  /** Custom-channel-only extra fields (not sent to GA) */
  extra?: Record<string, unknown>
  /** Defaults to the current popup page, or `noir_background` in the SW */
  pageId?: string
  /** 1 when the event involves a broadcast transaction */
  hasTransaction?: 0 | 1
  /** Exact transaction amount reported only to the encrypted custom collector. */
  inputAmount?: string
  inputSymbol?: string
  /** Token codes may contain identifiers and are discarded before reporting. */
  inputTokenCode?: string
  outputAmount?: string
  outputSymbol?: string
  outputTokenCode?: string
  /** Estimated transaction value reported only to the encrypted custom collector. */
  usdAmount?: string
  /** @deprecated Wallet addresses are never reported. */
  walletAddress?: string
}

export type AnalyticsMessage =
  | { type: 'ANALYTICS_EVENT'; name: string; options?: TrackOptions; timestamp?: number }
  | {
      type: 'ANALYTICS_PAGE_VIEW'
      engagementTimeMsec?: number
      page: string
      timestamp?: number
    }
