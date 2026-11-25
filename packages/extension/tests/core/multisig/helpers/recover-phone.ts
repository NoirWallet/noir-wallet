/**
 * The phone's side of restoring a reinstalled device, for tests: builds the recovery request from
 * a key package the way the iOS core does, and opens the extension's encrypted reply.
 */
import { x25519 } from '@noble/curves/ed25519'
import { pallas } from '@noble/curves/misc'
import { blake2b } from '@noble/hashes/blake2b'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import {
  checkRecoverRequest,
  recoverRequestSignedBytes
} from '../../../../src/core/multisig/recover-handshake'
import { verifyShareProof } from '../../../../src/core/multisig/share-proof'

export function makePhoneRecoverRequest(
  keyPackage: Uint8Array,
  publicKeyPackage: Uint8Array,
  identityPublicKey: Uint8Array
): { request: Uint8Array; ephemeralSecret: Uint8Array } {
  // Pinned frost-core KeyPackage postcard layout: header(5), identifier(32), signing share(32).
  if (keyPackage.length !== 134 || keyPackage[0] !== 0)
    throw new Error(
      `Unknown KeyPackage layout: length ${keyPackage.length}, version ${keyPackage[0]}`
    )
  const scalarBytes = keyPackage.slice(37, 69)
  const fromLe = (bytes: Uint8Array) => BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`)
  const toLe = (value: bigint) =>
    Uint8Array.from(Buffer.from(value.toString(16).padStart(64, '0'), 'hex').reverse())
  const baseBytes = Buffer.from(
    '63c975b884721a8d0ca1707be30c7f0c5f445f3e7c188d3b06d6f128b32355b7',
    'hex'
  )
  const odd = (baseBytes[31] & 0x80) !== 0
  baseBytes[31] &= 0x7f
  const base = pallas.ProjectivePoint.fromHex(
    `${odd ? '03' : '02'}${Buffer.from(baseBytes.reverse()).toString('hex')}`
  )
  try {
    const order = pallas.CURVE.n
    const scalar = fromLe(scalarBytes)
    if (scalar === 0n || scalar >= order) throw new Error('Invalid phone share')
    const pointBytes = (value: bigint): Uint8Array => {
      const compressed = base.multiply(value).toRawBytes(true)
      const bytes = Uint8Array.from(compressed.subarray(1)).reverse()
      if (compressed[0] === 3) bytes[31] |= 0x80
      return bytes
    }
    const verifyingShare = pointBytes(scalar)
    const ephemeralSecret = x25519.utils.randomPrivateKey()
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret)
    const issuedAt = Buffer.alloc(8)
    issuedAt.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)))
    const unsigned = Buffer.concat([
      Buffer.from([1]),
      Buffer.from(verifyingShare),
      Buffer.from(identityPublicKey),
      Buffer.from(ephemeralPublic),
      issuedAt
    ])
    const signed = recoverRequestSignedBytes({
      verifyingShare,
      identityPublicKey,
      ephemeralKey: ephemeralPublic,
      issuedAt: Number(issuedAt.readBigUInt64BE()),
      signature: new Uint8Array(64)
    })
    let nonce = fromLe(crypto.getRandomValues(new Uint8Array(32))) % order
    if (nonce === 0n) nonce = 1n
    const commitment = pointBytes(nonce)
    const challenge =
      fromLe(
        blake2b(
          Buffer.concat([
            Buffer.from(commitment),
            Buffer.from(verifyingShare),
            Buffer.from('noir/share-proof/v1'),
            Buffer.from(signed)
          ]),
          { dkLen: 64, personalization: new TextEncoder().encode('Zcash_RedPallasH') }
        )
      ) % order
    const signature = Buffer.concat([
      Buffer.from(commitment),
      Buffer.from(toLe((nonce + challenge * scalar) % order))
    ])
    if (!verifyShareProof(verifyingShare, signed, signature)) {
      throw new Error('Phone recovery proof does not verify')
    }
    const request = Uint8Array.from(Buffer.concat([unsigned, signature]))
    if (request.length !== 202 || request[33] !== 1)
      throw new Error('Unexpected phone recovery wire format')
    const checked = checkRecoverRequest(request, {
      publicKeyPackage,
      nowSeconds: Math.floor(Date.now() / 1000),
      ownSlot: 0
    })
    if (!checked.ok)
      throw new Error(
        `Phone recovery request rejected: ${checked.reason} (request ${request.length}, identity ${identityPublicKey.length}, proof ${signature.length}, version ${identityPublicKey[0]})`
      )
    return { request, ephemeralSecret }
  } finally {
    scalarBytes.fill(0)
  }
}

export async function openPhoneRecoverReply(
  request: Uint8Array,
  ephemeralSecret: Uint8Array,
  reply: Uint8Array
): Promise<Uint8Array> {
  if (reply[0] !== 1 || reply.length < 61) throw new Error('Invalid recovery reply')
  const shared = x25519.getSharedSecret(ephemeralSecret, reply.subarray(1, 33))
  const raw = hkdf(
    sha256,
    shared,
    sha256(request),
    new TextEncoder().encode('noir/recover-reply/v1'),
    32
  )
  const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [
    'decrypt'
  ])
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: reply.subarray(33, 45), additionalData: reply.subarray(0, 33) },
      key,
      reply.subarray(45)
    )
  )
}
