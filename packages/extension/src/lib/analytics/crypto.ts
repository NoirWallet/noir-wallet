/**
 * AES-128-CBC + PKCS#7 + Base64 payload encryption.
 *
 * Mirrors the backend Go implementation (EncryptStringFast/DecryptStringFast):
 * key and IV are both the password bytes truncated/zero-padded to 16 bytes.
 * Web Crypto applies PKCS#7 padding automatically for AES-CBC, matching Go.
 */

const AES_BLOCK_SIZE_BYTES = 16

function deriveKeyAndIv(password: string): Uint8Array<ArrayBuffer> {
  const keyIv = new Uint8Array(AES_BLOCK_SIZE_BYTES)
  keyIv.set(new TextEncoder().encode(password).subarray(0, AES_BLOCK_SIZE_BYTES))
  return keyIv
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** Encrypts a plaintext string and returns the Base64-encoded ciphertext. */
export async function encryptAnalyticsPayload(
  plaintext: string,
  password: string
): Promise<string> {
  const keyIv = deriveKeyAndIv(password)
  const cryptoKey = await crypto.subtle.importKey('raw', keyIv, { name: 'AES-CBC' }, false, [
    'encrypt'
  ])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: keyIv },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  )
  return encodeBase64(new Uint8Array(encrypted))
}
