const DATA_FRAME = 0x00
const TRAILER_FRAME = 0x80
const COMPRESSED_FLAG = 0x01

export interface ParsedGrpcWebResponse {
  dataFrames: Uint8Array[]
  trailers: Record<string, string>
}

interface VarintResult {
  value: bigint
  nextOffset: number
}

export function encodeGrpcWebRequest(payload: Uint8Array): Uint8Array {
  const framed = new Uint8Array(5 + payload.length)
  new DataView(framed.buffer).setUint32(1, payload.length)
  framed.set(payload, 5)
  return framed
}

export function encodeBlockRangeRequest(height: number): Uint8Array {
  assertPositiveSafeInteger(height, 'Block height')
  const blockId = Uint8Array.from([0x08, ...encodeVarint(height)])

  return Uint8Array.from([
    0x0a,
    ...encodeVarint(blockId.length),
    ...blockId,
    0x12,
    ...encodeVarint(blockId.length),
    ...blockId
  ])
}

export function encodeIronwoodSubtreeRootsRequest(): Uint8Array {
  // The wallet leaves startIndex and maxEntries at their proto3 defaults.
  return Uint8Array.from([0x10, 0x02])
}

export function parseGrpcWebResponse(body: Uint8Array): ParsedGrpcWebResponse {
  const dataFrames: Uint8Array[] = []
  const trailers: Record<string, string> = {}
  let offset = 0
  let foundTrailers = false

  while (offset < body.length) {
    if (body.length - offset < 5) {
      throw new Error('Truncated gRPC-Web frame header')
    }

    const flags = body[offset]
    const length = new DataView(body.buffer, body.byteOffset + offset + 1, 4).getUint32(0)
    offset += 5

    if (offset + length > body.length) {
      throw new Error('Truncated gRPC-Web frame payload')
    }
    if ((flags & COMPRESSED_FLAG) !== 0) {
      throw new Error('Compressed gRPC-Web frames are not supported by the monitor')
    }

    const frameType = flags & ~COMPRESSED_FLAG
    const payload = body.subarray(offset, offset + length)
    offset += length

    if (frameType === TRAILER_FRAME) {
      if (foundTrailers) {
        throw new Error('Multiple gRPC-Web trailer frames')
      }
      Object.assign(trailers, parseTrailers(payload))
      foundTrailers = true
      continue
    }

    if (frameType !== DATA_FRAME) {
      throw new Error(`Unsupported gRPC-Web frame flags: 0x${flags.toString(16)}`)
    }
    if (foundTrailers) {
      throw new Error('gRPC-Web data frame received after trailers')
    }
    dataFrames.push(payload)
  }

  if (!foundTrailers) {
    throw new Error('Missing gRPC-Web trailer frame')
  }

  const status = trailers['grpc-status']
  if (status === undefined) {
    throw new Error('Missing grpc-status trailer')
  }
  if (status !== '0') {
    const message = decodeGrpcMessage(trailers['grpc-message'])
    throw new Error(`gRPC status ${status}${message ? `: ${message}` : ''}`)
  }

  return { dataFrames, trailers }
}

export function decodeBlockHeight(message: Uint8Array): number {
  let offset = 0
  let height: bigint | undefined

  while (offset < message.length) {
    const key = readVarint(message, offset)
    offset = key.nextOffset
    const fieldNumber = Number(key.value >> 3n)
    const wireType = Number(key.value & 0x07n)

    if (fieldNumber === 1) {
      if (wireType !== 0) {
        throw new Error('Invalid BlockID height wire type')
      }
      const decoded = readVarint(message, offset)
      height = decoded.value
      offset = decoded.nextOffset
      continue
    }

    offset = skipField(message, offset, wireType)
  }

  if (height === undefined || height === 0n) {
    throw new Error('BlockID response does not contain a positive height')
  }
  if (height > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('BlockID height exceeds the JavaScript safe integer range')
  }
  return Number(height)
}

export function encodeVarint(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Varint value must be a non-negative safe integer')
  }

  const bytes: number[] = []
  let remaining = BigInt(value)
  do {
    let byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    if (remaining > 0n) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0n)

  return bytes
}

function parseTrailers(payload: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(payload)
  const trailers: Record<string, string> = {}

  for (const line of text.split('\r\n')) {
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator <= 0) {
      throw new Error('Malformed gRPC-Web trailer line')
    }
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (name in trailers && trailers[name] !== value) {
      throw new Error(`Conflicting gRPC-Web trailer: ${name}`)
    }
    trailers[name] = value
  }

  return trailers
}

function decodeGrpcMessage(value?: string): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function readVarint(bytes: Uint8Array, offset: number): VarintResult {
  let value = 0n
  let shift = 0n

  for (let index = offset; index < bytes.length && index < offset + 10; index += 1) {
    const byte = bytes[index]
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: index + 1 }
    }
    shift += 7n
  }

  throw new Error('Invalid or truncated protobuf varint')
}

function skipField(bytes: Uint8Array, offset: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return readVarint(bytes, offset).nextOffset
    case 1:
      return checkedOffset(bytes, offset, 8)
    case 2: {
      const length = readVarint(bytes, offset)
      if (length.value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Protobuf field length exceeds the safe integer range')
      }
      return checkedOffset(bytes, length.nextOffset, Number(length.value))
    }
    case 5:
      return checkedOffset(bytes, offset, 4)
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`)
  }
}

function checkedOffset(bytes: Uint8Array, offset: number, length: number): number {
  const nextOffset = offset + length
  if (nextOffset > bytes.length) {
    throw new Error('Truncated protobuf field')
  }
  return nextOffset
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}
