import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeBlockHeight,
  encodeBlockRangeRequest,
  encodeGrpcWebRequest,
  encodeIronwoodSubtreeRootsRequest,
  parseGrpcWebResponse
} from '../src/grpc-web'

test('encodes the fixed protobuf requests and gRPC-Web envelope', () => {
  assert.deepEqual(
    [...encodeBlockRangeRequest(100)],
    [0x0a, 0x02, 0x08, 0x64, 0x12, 0x02, 0x08, 0x64]
  )
  assert.deepEqual([...encodeIronwoodSubtreeRootsRequest()], [0x10, 0x02])
  assert.deepEqual([...encodeGrpcWebRequest(Uint8Array.from([1, 2, 3]))], [0, 0, 0, 0, 3, 1, 2, 3])
})

test('decodes BlockID height while ignoring other protobuf fields', () => {
  assert.equal(decodeBlockHeight(Uint8Array.from([0x12, 0x02, 0xaa, 0xbb, 0x08, 0xac, 0x02])), 300)
})

test('accepts both observed grpc-status trailer formats', () => {
  for (const trailer of ['grpc-status:0\r\n', 'grpc-status: 0\r\n']) {
    const response = concatFrames(dataFrame([0x08, 0x01]), trailerFrame(trailer))
    const parsed = parseGrpcWebResponse(response)
    assert.equal(parsed.dataFrames.length, 1)
    assert.equal(parsed.trailers['grpc-status'], '0')
  }
})

test('accepts a successful trailer-only empty stream', () => {
  const parsed = parseGrpcWebResponse(trailerFrame('grpc-status: 0\r\n'))
  assert.deepEqual(parsed.dataFrames, [])
})

test('rejects non-zero gRPC status with the decoded message', () => {
  assert.throws(
    () =>
      parseGrpcWebResponse(trailerFrame('grpc-status: 14\r\ngrpc-message: upstream%20down\r\n')),
    /gRPC status 14: upstream down/
  )
})

test('rejects malformed, truncated, and compressed frames', () => {
  assert.throws(
    () => parseGrpcWebResponse(Uint8Array.from([0, 0, 0])),
    /Truncated gRPC-Web frame header/
  )
  assert.throws(
    () => parseGrpcWebResponse(Uint8Array.from([0, 0, 0, 0, 2, 1])),
    /Truncated gRPC-Web frame payload/
  )
  assert.throws(
    () => parseGrpcWebResponse(concatFrames(frame(0x01, [1]), trailerFrame('grpc-status: 0\r\n'))),
    /Compressed gRPC-Web frames are not supported/
  )
  assert.throws(() => parseGrpcWebResponse(frame(0x02, [])), /Unsupported gRPC-Web frame flags/)
})

function dataFrame(payload: number[]): Uint8Array {
  return frame(0x00, payload)
}

function trailerFrame(trailers: string): Uint8Array {
  return frame(0x80, new TextEncoder().encode(trailers))
}

function frame(flags: number, payload: number[] | Uint8Array): Uint8Array {
  const data = Uint8Array.from(payload)
  const result = new Uint8Array(5 + data.length)
  result[0] = flags
  new DataView(result.buffer).setUint32(1, data.length)
  result.set(data, 5)
  return result
}

function concatFrames(...frames: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(frames.reduce((total, item) => total + item.length, 0))
  let offset = 0
  for (const item of frames) {
    result.set(item, offset)
    offset += item.length
  }
  return result
}
