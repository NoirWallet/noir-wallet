/**
 * Mnemonic Generator
 *
 * Provides BIP-39 mnemonic phrase generation and validation using WASM via Web Worker.
 */

import { getOffscreenClient } from '../worker/client'

const zcashWorkerClient = getOffscreenClient()
import { WALLET_CONFIG } from '@/config/wallet'
import { DEFAULT_NETWORK } from '@/config/networks'
import type { Network } from '@/types'

export class MnemonicGenerator {
  /**
   * Generate a BIP-39 mnemonic phrase
   * @param wordCount The packaged WASM supports generating 24 words.
   */
  static async generate(wordCount = WALLET_CONFIG.MNEMONIC_LENGTH): Promise<string> {
    return zcashWorkerClient.generateMnemonic(wordCount)
  }

  /**
   * Validate a BIP-39 mnemonic phrase
   * @param mnemonic The mnemonic phrase to validate
   */
  static async validate(mnemonic: string): Promise<boolean> {
    return zcashWorkerClient.validateMnemonic(mnemonic.trim())
  }

  /**
   * Generate a cryptographically secure mnemonic phrase
   * @param wordCount The packaged WASM supports generating 24 words.
   */
  static async generateSecurePhrase(wordCount = WALLET_CONFIG.MNEMONIC_LENGTH): Promise<string[]> {
    const phrase = await this.generate(wordCount)
    return phrase.split(' ')
  }

  /**
   * Convert mnemonic to encryption seed
   */
  static async toSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
    return zcashWorkerClient.mnemonicToSeed(mnemonic.trim(), passphrase)
  }

  /**
   * Derive addresses from mnemonic
   */
  static async toAddresses(
    mnemonic: string,
    accountIndex: number = 0,
    network: Network = DEFAULT_NETWORK
  ) {
    return zcashWorkerClient.mnemonicToAddresses(mnemonic.trim(), accountIndex, network)
  }
}
