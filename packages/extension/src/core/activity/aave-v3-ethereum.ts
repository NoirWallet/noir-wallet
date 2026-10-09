import { decodeFunctionData, parseAbi, type Hex } from 'viem'
import { parseAssetId } from '@/core/chains/registry'
import type { AssetId } from '@/core/chains/domain'

const CHAIN_ID = 'eip155:1'
const POOL = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2'
const ETH_GATEWAY = '0xd01607c3c5ecaba394d8be377a08590149325722'

const POOL_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)'
])
const GATEWAY_ABI = parseAbi([
  'function depositETH(address pool, address onBehalfOf, uint16 referralCode) payable'
])

export type AaveSupplyMethod = 'depositETH' | 'supply' | 'supplyWithPermit'

export interface AaveSupplyCall {
  readonly method: AaveSupplyMethod
  readonly assetId: AssetId
  readonly amountRaw: string
}

export function identifyAaveSupplyMethod(
  chainId: string,
  recipient: string,
  selector: string | undefined
): AaveSupplyMethod | null {
  if (chainId !== CHAIN_ID || !selector) return null
  const address = recipient.toLowerCase()
  const method = selector.toLowerCase()
  if (address === ETH_GATEWAY && method === '0x474cf53d') return 'depositETH'
  if (address === POOL && method === '0x617ba037') return 'supply'
  if (address === POOL && method === '0x02c205f0') return 'supplyWithPermit'
  return null
}

export function isAaveSupplyRecipient(chainId: string, recipient: string): boolean {
  return (
    chainId === CHAIN_ID &&
    (recipient.toLowerCase() === POOL || recipient.toLowerCase() === ETH_GATEWAY)
  )
}

export function decodeAaveSupplyCall(input: {
  readonly chainId: string
  readonly recipient: string
  readonly calldata: string | undefined
  readonly valueRaw: string
}): AaveSupplyCall | null {
  const { calldata, valueRaw } = input
  if (!calldata || !/^0x(?:[0-9a-fA-F]{2})+$/.test(calldata)) return null
  const method = identifyAaveSupplyMethod(input.chainId, input.recipient, calldata.slice(0, 10))
  if (!method) return null
  try {
    if (method === 'depositETH') {
      if (!/^[1-9][0-9]*$/.test(valueRaw)) return null
      const decoded = decodeFunctionData({ abi: GATEWAY_ABI, data: calldata as Hex })
      if (decoded.args[0].toLowerCase() !== POOL) return null
      return Object.freeze({
        method,
        assetId: parseAssetId(`${CHAIN_ID}/slip44:60`).id,
        amountRaw: valueRaw
      })
    }
    if (valueRaw !== '0') return null
    const decoded = decodeFunctionData({ abi: POOL_ABI, data: calldata as Hex })
    if (decoded.functionName !== method || decoded.args[1] <= 0n) return null
    return Object.freeze({
      method,
      assetId: parseAssetId(`${CHAIN_ID}/erc20:${decoded.args[0].toLowerCase()}`).id,
      amountRaw: decoded.args[1].toString()
    })
  } catch {
    return null
  }
}
