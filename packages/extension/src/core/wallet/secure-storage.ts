import { WALLET_CONFIG } from '@/config/wallet'
import type { HardwareWalletData } from '@/types'
import { SESSION_PASSWORD_STORAGE_KEY } from './session-state'

interface StoredData {
  encryptedData: string
  salt: string
  iv: string
}

export type EncryptedCredentialResult =
  | { status: 'valid'; data: unknown }
  | { status: 'missing' | 'invalid' | 'wrong_password' }

export class SecureStorage {
  // ==================== Encryption ====================

  static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    )

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false, // NOT extractable - key cannot be exported
      ['encrypt', 'decrypt']
    )
  }

  static async encrypt(data: string, password: string): Promise<StoredData> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await this.deriveKey(password, salt)

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encoder.encode(data)
    )

    return {
      encryptedData: this.bufferToBase64(encryptedBuffer),
      salt: this.bufferToBase64(salt.buffer),
      iv: this.bufferToBase64(iv.buffer)
    }
  }

  static async decrypt(storedData: StoredData, password: string): Promise<string> {
    const salt = this.base64ToBuffer(storedData.salt)
    const iv = this.base64ToBuffer(storedData.iv)
    const encryptedData = this.base64ToBuffer(storedData.encryptedData)
    const key = await this.deriveKey(password, salt)

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encryptedData as BufferSource
    )

    const decoder = new TextDecoder()
    return decoder.decode(decryptedBuffer)
  }

  // ==================== Storage Operations ====================

  static async saveEncrypted(key: string, data: any, password: string): Promise<void> {
    const jsonData = JSON.stringify(data)
    const encrypted = await this.encrypt(jsonData, password)
    await chrome.storage.local.set({ [key]: encrypted })
  }

  static async loadEncrypted(key: string, password: string): Promise<any> {
    const result = await chrome.storage.local.get(key)
    if (!result[key]) {
      return null
    }

    try {
      const decrypted = await this.decrypt(result[key], password)
      return JSON.parse(decrypted)
    } catch (error) {
      // Decryption failed (wrong password or corrupted data)
      // Return null to trigger failed attempt tracking in unlock flow
      console.warn('[SecureStorage] Decryption failed for key:', key)
      return null
    }
  }

  static async inspectEncryptedCredential(
    key: string,
    password: string
  ): Promise<EncryptedCredentialResult> {
    const result = await chrome.storage.local.get(key)
    const stored: unknown = result[key]
    if (stored === undefined || stored === null) return { status: 'missing' }
    if (!stored || typeof stored !== 'object') return { status: 'invalid' }
    const fields = stored as Record<string, unknown>
    if (
      typeof fields.salt !== 'string' ||
      typeof fields.iv !== 'string' ||
      typeof fields.encryptedData !== 'string'
    ) {
      return { status: 'invalid' }
    }

    try {
      if (
        this.base64ToBuffer(fields.salt).length !== 16 ||
        this.base64ToBuffer(fields.iv).length !== 12 ||
        this.base64ToBuffer(fields.encryptedData).length < 16
      ) {
        return { status: 'invalid' }
      }
    } catch {
      return { status: 'invalid' }
    }

    const salt = this.base64ToBuffer(fields.salt)
    const iv = this.base64ToBuffer(fields.iv)
    const encryptedData = this.base64ToBuffer(fields.encryptedData)
    const derivedKey = await this.deriveKey(password, salt)
    let decryptedBuffer: ArrayBuffer
    try {
      decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        derivedKey,
        encryptedData as BufferSource
      )
    } catch {
      // AES-GCM cannot distinguish a wrong password from altered ciphertext.
      return { status: 'wrong_password' }
    }
    try {
      return {
        status: 'valid',
        data: JSON.parse(new TextDecoder().decode(decryptedBuffer)) as unknown
      }
    } catch {
      return { status: 'invalid' }
    }
  }

  static async saveWalletSeedPhrase(
    walletId: string,
    seedPhrase: string,
    password: string
  ): Promise<void> {
    const key = `seed_${walletId}`
    await this.saveEncrypted(key, { seedPhrase }, password)
  }

  static async loadWalletSeedPhrase(walletId: string, password: string): Promise<string | null> {
    const key = `seed_${walletId}`
    const data = await this.loadEncrypted(key, password)
    return typeof data?.seedPhrase === 'string' && data.seedPhrase.trim() ? data.seedPhrase : null
  }

  static async removeWalletSeedPhrase(walletId: string): Promise<void> {
    await chrome.storage.local.remove(`seed_${walletId}`)
  }

  // ==================== Hardware Wallet Credentials ====================
  // Encrypted with the same password-derived key as seed phrases, so a
  // successful decrypt doubles as password verification for hardware wallets.

  static async saveHardwareWalletData(
    walletId: string,
    data: HardwareWalletData,
    password: string
  ): Promise<void> {
    await this.saveEncrypted(`hw_${walletId}`, data, password)
  }

  static async loadHardwareWalletData(
    walletId: string,
    password: string
  ): Promise<HardwareWalletData | null> {
    const data = await this.loadEncrypted(`hw_${walletId}`, password)
    return data?.ufvk ? (data as HardwareWalletData) : null
  }

  static async removeHardwareWalletData(walletId: string): Promise<void> {
    await chrome.storage.local.remove(`hw_${walletId}`)
  }

  // ==================== Login Attempt Limiting ====================

  private static readonly LOGIN_ATTEMPTS_KEY = 'login_attempts'
  private static readonly MAX_ATTEMPTS = WALLET_CONFIG.SECURITY.LOGIN_ATTEMPTS.MAX_ATTEMPTS
  private static readonly LOCKOUT_DURATION_MS =
    WALLET_CONFIG.SECURITY.LOGIN_ATTEMPTS.LOCKOUT_DURATION_MS

  static async getLoginAttempts(): Promise<{
    failedCount: number
    remainingAttempts: number
    isLocked: boolean
    lockRemainingMs: number
  }> {
    const result = await chrome.storage.local.get(this.LOGIN_ATTEMPTS_KEY)
    const data = result[this.LOGIN_ATTEMPTS_KEY] as
      | { failedCount: number; lastFailedAt: number; lockedUntil: number }
      | undefined

    if (!data) {
      return {
        failedCount: 0,
        remainingAttempts: this.MAX_ATTEMPTS,
        isLocked: false,
        lockRemainingMs: 0
      }
    }

    const now = Date.now()
    const isLocked = data.lockedUntil > now
    const lockRemainingMs = isLocked ? data.lockedUntil - now : 0

    // Reset counter if lockout has expired
    if (!isLocked && data.lockedUntil > 0) {
      await this.resetLoginAttempts()
      return {
        failedCount: 0,
        remainingAttempts: this.MAX_ATTEMPTS,
        isLocked: false,
        lockRemainingMs: 0
      }
    }

    return {
      failedCount: data.failedCount,
      remainingAttempts: Math.max(0, this.MAX_ATTEMPTS - data.failedCount),
      isLocked,
      lockRemainingMs
    }
  }

  static async recordFailedAttempt(): Promise<{
    remainingAttempts: number
    isLocked: boolean
    lockRemainingMs: number
  }> {
    const result = await chrome.storage.local.get(this.LOGIN_ATTEMPTS_KEY)
    const data = (result[this.LOGIN_ATTEMPTS_KEY] as {
      failedCount: number
      lastFailedAt: number
      lockedUntil: number
    }) || { failedCount: 0, lastFailedAt: 0, lockedUntil: 0 }

    const now = Date.now()
    data.failedCount += 1
    data.lastFailedAt = now

    if (data.failedCount >= this.MAX_ATTEMPTS) {
      data.lockedUntil = now + this.LOCKOUT_DURATION_MS
    }

    await chrome.storage.local.set({ [this.LOGIN_ATTEMPTS_KEY]: data })

    const isLocked = data.lockedUntil > now
    return {
      remainingAttempts: Math.max(0, this.MAX_ATTEMPTS - data.failedCount),
      isLocked,
      lockRemainingMs: isLocked ? data.lockedUntil - now : 0
    }
  }

  static async resetLoginAttempts(): Promise<void> {
    await chrome.storage.local.remove(this.LOGIN_ATTEMPTS_KEY)
  }

  // ==================== Activity Time Tracking ====================

  private static readonly LAST_ACTIVITY_KEY = 'last_activity_time'

  static async saveLastActivityTime(): Promise<void> {
    await chrome.storage.local.set({ [this.LAST_ACTIVITY_KEY]: Date.now() })
  }

  static async getLastActivityTime(): Promise<number | null> {
    const result = await chrome.storage.local.get(this.LAST_ACTIVITY_KEY)
    return result[this.LAST_ACTIVITY_KEY] || null
  }

  static async clearLastActivityTime(): Promise<void> {
    await chrome.storage.local.remove(this.LAST_ACTIVITY_KEY)
  }

  // ==================== Session Password Management ====================
  //
  // Security design:
  // The unlock password is AES-GCM encrypted before being stored in
  // chrome.storage.session. The encryption key material is also kept in session
  // storage so that all extension contexts (popup, background, offscreen) can
  // decrypt it — this is an inherent constraint of Chrome Extension's
  // multi-process architecture where popup and background run in separate JS
  // contexts with no shared memory.
  //
  // Threat model & mitigations:
  // 1. chrome.storage.session is accessible ONLY to this extension's contexts
  //    (not to web pages or other extensions) and is cleared on browser close.
  // 2. The encryption prevents the password from appearing as a readable string
  //    in session storage dumps / DevTools inspection, adding a practical layer
  //    of defense against casual exposure (e.g. screenshots, shoulder surfing,
  //    debug logs that dump storage).
  // 3. A full extension-context compromise (e.g. malicious code running inside
  //    this extension) would allow reading both key and ciphertext. This is a
  //    known limitation accepted by all major browser wallets (MetaMask, Phantom,
  //    etc.) — at that point the attacker already has full access to the DOM and
  //    can intercept the password at entry time.
  // 4. setAccessLevel is kept at the default (TRUSTED_CONTEXTS only) to prevent
  //    content scripts from reading session storage.

  private static readonly SESSION_PASSWORD_KEY = SESSION_PASSWORD_STORAGE_KEY
  private static readonly SESSION_KEY_MATERIAL_KEY = 'session_key_material'
  private static sessionEncryptionKey: CryptoKey | null = null

  private static async getSessionKey(): Promise<CryptoKey> {
    if (this.sessionEncryptionKey) {
      return this.sessionEncryptionKey
    }

    const result = await chrome.storage.session.get(this.SESSION_KEY_MATERIAL_KEY)
    let keyMaterial: Uint8Array

    if (result[this.SESSION_KEY_MATERIAL_KEY]) {
      keyMaterial = new Uint8Array(result[this.SESSION_KEY_MATERIAL_KEY])
    } else {
      keyMaterial = crypto.getRandomValues(new Uint8Array(32))
      await chrome.storage.session.set({
        [this.SESSION_KEY_MATERIAL_KEY]: Array.from(keyMaterial)
      })
    }

    this.sessionEncryptionKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )

    return this.sessionEncryptionKey
  }

  /**
   * Save password encrypted to chrome.storage.session.
   * Shared across all extension contexts (popup, background, offscreen).
   * Auto-clears when browser closes.
   */
  static async saveSessionPassword(password: string): Promise<void> {
    const key = await this.getSessionKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoder = new TextEncoder()

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(password)
    )

    await chrome.storage.session.set({
      [this.SESSION_PASSWORD_KEY]: {
        encrypted: this.bufferToBase64(encryptedBuffer),
        iv: this.bufferToBase64(iv.buffer)
      }
    })
  }

  /**
   * Get session password from chrome.storage.session (decrypted).
   * Returns null if data is missing or decryption fails.
   */
  static async getSessionPassword(): Promise<string | null> {
    const result = await chrome.storage.session.get(this.SESSION_PASSWORD_KEY)
    const data = result[this.SESSION_PASSWORD_KEY]

    if (!data) return null

    if (typeof data === 'string') {
      await chrome.storage.session.remove(this.SESSION_PASSWORD_KEY)
      return null
    }

    if (!data.encrypted || !data.iv) return null

    try {
      const key = await this.getSessionKey()
      const encryptedData = this.base64ToBuffer(data.encrypted)
      const ivData = this.base64ToBuffer(data.iv)

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivData as BufferSource },
        key,
        encryptedData as BufferSource
      )

      return new TextDecoder().decode(decryptedBuffer)
    } catch {
      return null
    }
  }

  /**
   * Clear session password and key material from chrome.storage.session
   */
  static async clearSessionPassword(): Promise<void> {
    this.sessionEncryptionKey = null
    await chrome.storage.session.remove([this.SESSION_PASSWORD_KEY, this.SESSION_KEY_MATERIAL_KEY])
  }

  // ==================== Secure Memory ====================

  /** Zero out Uint8Array contents - most reliable way to clear sensitive data */
  static secureZeroArray(arr: Uint8Array): void {
    if (!arr || arr.length === 0) return
    arr.fill(0)
  }

  // ==================== Private Helpers ====================

  private static bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  private static base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
