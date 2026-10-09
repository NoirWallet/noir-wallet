import {
  parseAssetMarketHistoryReadModel,
  type AssetMarketHistoryRange,
  type AssetMarketHistoryReadModel
} from '@/core/prices'

type AssetMarketHistoryRuntimeMessenger = (
  message: Readonly<Record<string, unknown>>
) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function createAssetMarketHistoryClient(sendMessage: AssetMarketHistoryRuntimeMessenger) {
  return Object.freeze({
    async getHistory(
      assetId: string,
      range: AssetMarketHistoryRange,
      action: 'read' | 'refresh'
    ): Promise<AssetMarketHistoryReadModel | null> {
      const response = await sendMessage({
        type: 'GET_ASSET_MARKET_HISTORY',
        assetId,
        range,
        action
      })
      if (
        !isRecord(response) ||
        Object.keys(response).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(response, 'result')
      ) {
        throw new Error('Invalid asset market history response')
      }
      if (response.result === null) return null
      const result = parseAssetMarketHistoryReadModel(response.result)
      if (result.assetId !== assetId || result.range !== range) {
        throw new Error('Asset market history response does not match the request')
      }
      return result
    }
  })
}

export const assetMarketHistoryClient = createAssetMarketHistoryClient(message =>
  chrome.runtime.sendMessage(message)
)
