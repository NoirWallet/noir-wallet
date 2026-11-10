import type { SignupStore } from './signup-store'
import { renderSignupMail, type MailSettings, type SignupMail } from './signup-mail'

export type DeliveryOutcome = 'retry' | 'failed' | 'unknown'

type AlarmStorage = Pick<DurableObjectStorage, 'getAlarm' | 'setAlarm'>

export async function ensureMailAlarm(storage: AlarmStorage, target: number): Promise<void> {
  const alarm = await storage.getAlarm()
  if (alarm === null || alarm > target) await storage.setAlarm(target)
}

export async function scheduleNextMail(
  store: SignupStore,
  storage: AlarmStorage,
  now: () => number = Date.now
): Promise<void> {
  const next = store.nextMailTime()
  if (next !== null) await ensureMailAlarm(storage, Math.max(next, now() + 1000))
}

export async function runSignupMailAlarm(
  store: SignupStore,
  storage: AlarmStorage,
  readSettings: () => MailSettings,
  send: (settings: MailSettings, mail: SignupMail) => Promise<void>,
  now: () => number = Date.now
): Promise<void> {
  const next = store.nextMailTime()
  if (next === null) return
  let settings: MailSettings
  try {
    settings = readSettings()
  } catch {
    // A configuration outage must not consume a job or exhaust platform alarm retries.
    await ensureMailAlarm(storage, Math.max(next, now() + 300000))
    console.warn('Signup mail configuration unavailable; delivery deferred')
    return
  }
  await deliverNextSignup(store, settings, mail => send(settings, mail), now)
  await scheduleNextMail(store, storage, now)
}

export interface MailDiagnostic {
  code: string
  stage: string
  smtpCode: number | null
  name: string
}

export function mailDiagnostic(error: unknown): MailDiagnostic {
  const failure =
    error && typeof error === 'object'
      ? (error as { code?: unknown; command?: unknown; responseCode?: unknown; name?: unknown })
      : {}
  const code =
    typeof failure.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code)
      ? failure.code
      : 'MAIL_ERROR'
  const command = typeof failure.command === 'string' ? failure.command.toUpperCase().trim() : ''
  const stages: Record<string, string> = {
    CONN: 'CONNECT',
    EHLO: 'GREETING',
    HELO: 'GREETING',
    'MAIL FROM': 'MAIL_FROM',
    'RCPT TO': 'RCPT_TO',
    DATA: 'DATA'
  }
  const stage = /^AUTH(?: (?:PLAIN|LOGIN|CRAM-MD5|XOAUTH2))?$/.test(command)
    ? 'AUTH'
    : (stages[command] ?? 'UNSPECIFIED')
  const smtpCode =
    typeof failure.responseCode === 'number' &&
    Number.isInteger(failure.responseCode) &&
    failure.responseCode >= 100 &&
    failure.responseCode <= 599
      ? failure.responseCode
      : null
  const name =
    typeof failure.name === 'string' &&
    ['Error', 'TypeError', 'RangeError', 'AbortError'].includes(failure.name)
      ? failure.name
      : 'Error'
  return { code, stage, smtpCode, name }
}

export function deliveryOutcome(error: unknown): DeliveryOutcome {
  const smtpCode = mailDiagnostic(error).smtpCode
  if (smtpCode !== null && smtpCode >= 400 && smtpCode < 500) return 'retry'
  if (smtpCode !== null && smtpCode >= 500) return 'failed'
  // A socket failure after DATA may mean that the server accepted the message.
  return 'unknown'
}

export async function deliverNextSignup(
  store: SignupStore,
  settings: MailSettings,
  send: (mail: SignupMail) => Promise<void>,
  now: () => number = Date.now
): Promise<void> {
  const job = store.claimMail(now())
  if (!job) return
  let outcome: 'sent' | DeliveryOutcome = 'sent'
  let diagnostic: MailDiagnostic | null = null
  try {
    await send(renderSignupMail(settings.template, job.email, job.id))
  } catch (error) {
    outcome = deliveryOutcome(error)
    diagnostic = mailDiagnostic(error)
  }
  store.finishMail(job.id, outcome, now(), diagnostic)
  if (diagnostic) console.warn('Signup mail delivery failed', { outcome, ...diagnostic })
}
