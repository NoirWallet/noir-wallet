export interface SignupReceipt {
  ok: true
}

export function parseSignupReceipt(value: unknown): SignupReceipt {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true) {
    throw new Error('Your signup could not be confirmed. Please try again.')
  }
  return { ok: true }
}

export function parseSignupHealth(value: unknown): { status: 'ok' } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('status' in value) ||
    value.status !== 'ok'
  ) {
    throw new Error('The signup service is not ready.')
  }
  return { status: 'ok' }
}

export async function submitSignup(
  email: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<SignupReceipt> {
  const trimmed = email.trim()
  if (trimmed.length === 0 || trimmed.length > 254) {
    throw new Error('Please enter a valid email address.')
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, 10_000)
  try {
    let response: Response
    try {
      response = await fetcher('/api/frost-signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
        cache: 'no-store',
        signal: controller.signal
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) throw new Error('Signup timed out. Please try again.')
      throw new Error('Signup is temporarily unavailable. Please try again.')
    }
    if (response.status === 400) throw new Error('Please enter a valid email address.')
    if (!response.ok) throw new Error('Signup is temporarily unavailable. Please try again.')
    let receipt: unknown
    try {
      receipt = await response.json()
    } catch {
      throw new Error('Your signup could not be confirmed. Please try again.')
    }
    return parseSignupReceipt(receipt)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
