export const HARDWARE_SIGN_RESULT_MESSAGE = 'HARDWARE_SIGN_FLOW_RESULT'

const RESULT_PREFIX = 'hw_sign_result_'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

export interface HardwareSignSuccessResult {
  requestId: string
  status: 'success'
  txHash: string
  accountKey: string
  transactionId?: string
  amount?: string
  completedAt: number
}

export interface HardwareSignStoppedResult {
  requestId: string
  status: 'cancelled' | 'timeout'
  error: string
  completedAt: number
}

export type HardwareSignResult = HardwareSignSuccessResult | HardwareSignStoppedResult

function resultKey(requestId: string): string {
  return RESULT_PREFIX + requestId
}

function parseHardwareSignResult(value: unknown): HardwareSignResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.requestId !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.completedAt !== 'number'
  ) {
    return null
  }

  if (candidate.status === 'success') {
    if (typeof candidate.txHash !== 'string' || typeof candidate.accountKey !== 'string') {
      return null
    }
    return {
      requestId: candidate.requestId,
      status: 'success',
      txHash: candidate.txHash,
      accountKey: candidate.accountKey,
      transactionId:
        typeof candidate.transactionId === 'string' ? candidate.transactionId : undefined,
      amount: typeof candidate.amount === 'string' ? candidate.amount : undefined,
      completedAt: candidate.completedAt
    }
  }

  if (
    (candidate.status === 'cancelled' || candidate.status === 'timeout') &&
    typeof candidate.error === 'string'
  ) {
    return {
      requestId: candidate.requestId,
      status: candidate.status,
      error: candidate.error,
      completedAt: candidate.completedAt
    }
  }

  return null
}

export async function publishHardwareSignResult(result: HardwareSignSuccessResult): Promise<void> {
  await chrome.storage.session.set({ [resultKey(result.requestId)]: result })
  chrome.runtime.sendMessage({ type: HARDWARE_SIGN_RESULT_MESSAGE, result }).catch(() => {})
}

async function readHardwareSignResult(requestId: string): Promise<HardwareSignResult | null> {
  const key = resultKey(requestId)
  const stored = await chrome.storage.session.get(key)
  const result = parseHardwareSignResult(stored[key])
  return result?.requestId === requestId ? result : null
}

/**
 * Wait for the result associated with one signing surface. The persisted result
 * closes the listener-registration race; runtime and storage events only reduce latency.
 */
export function waitForHardwareSignResult({
  requestId,
  tabId,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: {
  requestId: string
  tabId?: number
  timeoutMs?: number
}): Promise<HardwareSignResult> {
  const key = resultKey(requestId)

  return new Promise(resolve => {
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(onMessage)
      chrome.storage.onChanged.removeListener(onStorageChanged)
      chrome.tabs.onRemoved.removeListener(onTabRemoved)
    }

    const finish = (result: HardwareSignResult) => {
      if (settled) return
      settled = true
      cleanup()
      chrome.storage.session.remove(key).catch(() => {})
      resolve(result)
    }

    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return
      const candidate = message as Record<string, unknown>
      if (candidate.type !== HARDWARE_SIGN_RESULT_MESSAGE) return
      const result = parseHardwareSignResult(candidate.result)
      if (result?.requestId === requestId) finish(result)
    }

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'session') return
      const result = parseHardwareSignResult(changes[key]?.newValue)
      if (result?.requestId === requestId) finish(result)
    }

    const onTabRemoved = (removedTabId: number) => {
      if (tabId === undefined || removedTabId !== tabId) return
      void readHardwareSignResult(requestId)
        .then(result => {
          finish(
            result ?? {
              requestId,
              status: 'cancelled',
              error: 'Hardware signing was cancelled',
              completedAt: Date.now()
            }
          )
        })
        .catch(() => {
          finish({
            requestId,
            status: 'cancelled',
            error: 'Hardware signing was cancelled',
            completedAt: Date.now()
          })
        })
    }

    const timer = setTimeout(() => {
      finish({
        requestId,
        status: 'timeout',
        error: 'Hardware signing timed out',
        completedAt: Date.now()
      })
      if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => {})
    }, timeoutMs)

    chrome.runtime.onMessage.addListener(onMessage)
    chrome.storage.onChanged.addListener(onStorageChanged)
    chrome.tabs.onRemoved.addListener(onTabRemoved)

    void readHardwareSignResult(requestId)
      .then(result => {
        if (result) finish(result)
      })
      .catch(() => {})
  })
}
