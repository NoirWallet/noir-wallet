import './buffer-polyfill'
import { URDecoder } from '@ngraveio/bc-ur'
import type { UR } from '@ngraveio/bc-ur'

/** Accumulates camera frames across devices within one scan step. */
export class UrScanDecoder {
  private decoder = new URDecoder()
  private firstPart: string | null = null
  private completed = new Map<string, string>()

  receive(text: string): { ur: UR | null; progress: number } {
    const part = text.trim().toLowerCase()
    try {
      const isMultipart = URDecoder.parse(part)[1].length === 2
      for (const seed of this.completed.values()) {
        if (seed === part) return this.pending()
        if (isMultipart && URDecoder.parse(seed)[1].length === 2) {
          // A fresh decoder compares fountain metadata even for unseen mixed frames.
          const probe = new URDecoder()
          probe.receivePart(seed)
          if (probe.receivePart(part)) return this.pending()
        }
      }
      // A single-frame code can complete even while bc-ur is collecting another message.
      if (!isMultipart && this.firstPart) this.reset()
      if (!this.decoder.receivePart(part)) {
        this.reset()
        if (!this.decoder.receivePart(part)) {
          this.reset()
          return this.pending()
        }
      }
      this.firstPart ??= part
      if (this.decoder.isError()) throw new Error(this.decoder.resultError())
      if (!this.decoder.isComplete()) return this.pending()

      const ur = this.decoder.resultUR()
      const key = this.key(ur)
      const seen = this.completed.has(key)
      if (!seen) {
        this.completed.set(key, this.firstPart)
        if (this.completed.size > 8) this.completed.delete(this.completed.keys().next().value!)
      }
      this.reset()
      return seen ? this.pending() : { ur, progress: 100 }
    } catch (error) {
      this.reset()
      throw error
    }
  }

  allowRetry(ur: UR): void {
    this.completed.delete(this.key(ur))
  }

  private key(ur: UR): string {
    return `${ur.type}:${ur.cbor.toString('hex')}`
  }

  private pending() {
    return {
      ur: null,
      progress: Math.min(99, Math.round(this.decoder.estimatedPercentComplete() * 100))
    }
  }

  private reset(): void {
    this.decoder = new URDecoder()
    this.firstPart = null
  }
}
