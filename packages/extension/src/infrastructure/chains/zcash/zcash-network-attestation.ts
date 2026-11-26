import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/config/extension'
import { FetchResponseTooLargeError, fetchWithTimeout } from '@/lib/fetch-utils'
import type { Network } from '@/types'

export interface AttestZcashLightwalletdEndpointInput {
  readonly network: Network
  readonly baseUrl: string
  readonly signal?: AbortSignal
}

const MAXIMUM_RESPONSE_BYTES = 1024 * 1024

function parseBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid Zcash lightwalletd URL')
  }
  const localDevelopmentHost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopmentHost)) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('Zcash lightwalletd URL must be a credential-free HTTPS endpoint')
  }
  return url.toString().replace(/\/+$/, '')
}

function readVarint(
  bytes: Uint8Array,
  start: number
): { readonly value: number; readonly next: number } {
  let value = 0
  let shift = 0
  for (let offset = start; offset < bytes.length && offset < start + 5; offset += 1) {
    const byte = bytes[offset]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return Object.freeze({ value, next: offset + 1 })
    shift += 7
  }
  throw new Error('Invalid lightwalletd protobuf varint')
}

function readChainName(message: Uint8Array): string {
  let offset = 0
  while (offset < message.length) {
    const tag = readVarint(message, offset)
    offset = tag.next
    const field = tag.value >>> 3
    const wireType = tag.value & 7
    if (wireType === 0) {
      offset = readVarint(message, offset).next
      continue
    }
    if (wireType === 1) {
      offset += 8
      continue
    }
    if (wireType === 5) {
      offset += 4
      continue
    }
    if (wireType !== 2) throw new Error('Unsupported lightwalletd protobuf field')
    const length = readVarint(message, offset)
    const end = length.next + length.value
    if (end > message.length) throw new Error('Truncated lightwalletd protobuf field')
    if (field === 4) {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(
        message.subarray(length.next, end)
      )
      if (value.length === 0 || value.length > 32)
        throw new Error('Invalid lightwalletd chain name')
      return value
    }
    offset = end
  }
  throw new Error('Lightwalletd response has no chain identity')
}

function readGrpcWebDataFrame(body: Uint8Array): Uint8Array {
  let offset = 0
  while (offset + 5 <= body.length) {
    const flags = body[offset]
    const length = new DataView(body.buffer, body.byteOffset + offset + 1, 4).getUint32(0)
    const start = offset + 5
    const end = start + length
    if (end > body.length) throw new Error('Truncated lightwalletd gRPC-Web frame')
    if ((flags & 0x80) === 0) {
      if (flags !== 0) throw new Error('Unsupported lightwalletd gRPC-Web frame')
      return body.subarray(start, end)
    }
    offset = end
  }
  throw new Error('Lightwalletd response has no gRPC-Web data frame')
}

export async function attestZcashLightwalletdEndpoint(
  input: AttestZcashLightwalletdEndpointInput
): Promise<void> {
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  try {
    const response = await fetchWithTimeout(
      `${parseBaseUrl(input.baseUrl)}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1'
        },
        body: new Uint8Array(5),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: input.signal,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        maxBytes: MAXIMUM_RESPONSE_BYTES,
        acceptHttpErrors: 'status-only'
      }
    )
    if (!response.ok) throw new Error('Lightwalletd endpoint is unavailable')
    if (!response.headers.get('content-type')?.startsWith('application/grpc-web')) {
      throw new Error('Lightwalletd endpoint returned an invalid content type')
    }
    const chainName = readChainName(
      readGrpcWebDataFrame(new Uint8Array(await response.arrayBuffer()))
    )
    const expected = input.network === 'mainnet' ? 'main' : 'test'
    if (chainName !== expected) throw new Error('Lightwalletd endpoint network does not match')
  } catch (error) {
    if (error instanceof FetchResponseTooLargeError) {
      throw new Error('Lightwalletd response exceeds the allowed size')
    }
    throw error
  }
}
