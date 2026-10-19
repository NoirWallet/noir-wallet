import type { Network } from '@/types'

export interface PendingRequest {
  id: string
  origin: string
  action: string
  data: any
  walletId: string
  accountId: string
  network: Network
  authorizationRevision: number
  timestamp: number
}

class PendingRequestsManager {
  private requests = new Map<string, PendingRequest>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private cancellations = new Map<string, () => void>()

  /**
   * Create a pending request and return its ID.
   * Captures walletId/accountId at creation time so the correct wallet
   * is used even if the user switches accounts before approval.
   */
  create(
    origin: string,
    action: string,
    data: any,
    walletId: string,
    accountId: string,
    network: Network,
    authorizationRevision: number
  ): string {
    const id = crypto.randomUUID()

    this.requests.set(id, {
      id,
      origin,
      action,
      data,
      walletId,
      accountId,
      network,
      authorizationRevision,
      timestamp: Date.now()
    })

    // Auto-cleanup after 5 minutes
    this.timers.set(
      id,
      setTimeout(
        () => {
          this.cancel(id)
        },
        5 * 60 * 1000
      )
    )

    return id
  }

  /**
   * Get a pending request without removing it
   */
  get(id: string): PendingRequest | null {
    return this.requests.get(id) || null
  }

  /**
   * Get and remove a pending request
   */
  consume(id: string): PendingRequest | null {
    const request = this.requests.get(id)
    if (request) {
      this.cancel(id)
      return request
    }
    return null
  }

  /**
   * Cancel a pending request
   */
  cancel(id: string): void {
    this.requests.delete(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    const onCancel = this.cancellations.get(id)
    this.cancellations.delete(id)
    onCancel?.()
  }

  onCancel(id: string, callback: () => void): void {
    this.cancellations.set(id, callback)
  }

  cancelMatching(matches: (request: PendingRequest) => boolean): void {
    for (const request of this.requests.values()) {
      if (matches(request)) this.cancel(request.id)
    }
  }
}

export const pendingRequestsManager = new PendingRequestsManager()
