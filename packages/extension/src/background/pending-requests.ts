interface PendingRequest {
  id: string
  origin: string
  action: string
  data: any
  walletId: string
  accountId: string
  timestamp: number
  walletConnect?: { verification: 'VALID' | 'UNKNOWN' }
}

class PendingRequestsManager {
  private requests = new Map<string, PendingRequest>()

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
    walletConnect?: PendingRequest['walletConnect']
  ): string {
    const id = crypto.randomUUID()

    this.requests.set(id, {
      id,
      origin,
      action,
      data,
      walletId,
      accountId,
      ...(walletConnect ? { walletConnect } : {}),
      timestamp: Date.now()
    })

    // Auto-cleanup after 5 minutes
    setTimeout(
      () => {
        this.requests.delete(id)
      },
      5 * 60 * 1000
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
      this.requests.delete(id)
      return request
    }
    return null
  }

  /**
   * Cancel a pending request
   */
  cancel(id: string): void {
    this.requests.delete(id)
  }
}

export const pendingRequestsManager = new PendingRequestsManager()
