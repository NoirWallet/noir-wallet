import { DurableObject } from 'cloudflare:workers'
import { handleSignupRequest } from './api'
import { SignupStore } from './signup-store'
import { readMailSettings, type MailSecrets } from './signup-mail'
import { ensureMailAlarm, runSignupMailAlarm, scheduleNextMail } from './mail-delivery'
import { sendGmail } from './gmail-smtp'

interface Env extends MailSecrets {
  FROST_VOTES: DurableObjectNamespace<FrostVotes>
  ALLOWED_ORIGINS: string
  MAIL_MODE?: string
}

// Preserve the deployed class and binding names while using a separate object for signups.
export class FrostVotes extends DurableObject<Env> {
  private readonly signups: SignupStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.signups = new SignupStore(ctx.storage.sql, callback =>
      ctx.storage.transactionSync(callback)
    )
    ctx.blockConcurrencyWhile(async () => {
      await this.scheduleMail()
    })
  }

  async register(email: string, createdAt: number): Promise<void> {
    if (this.env.MAIL_MODE === 'disabled') {
      this.signups.register(email, createdAt)
      return
    }
    readMailSettings(this.env)
    // Schedule first so an interrupted request cannot leave a committed job without an alarm.
    await ensureMailAlarm(this.ctx.storage, Date.now() + 1000)
    this.signups.registerWithMail(email, createdAt, crypto.randomUUID())
  }

  async ready(): Promise<void> {
    this.signups.ready()
    if (this.env.MAIL_MODE !== 'disabled') readMailSettings(this.env)
  }

  async alarm(): Promise<void> {
    if (this.env.MAIL_MODE === 'disabled') return
    await runSignupMailAlarm(
      this.signups,
      this.ctx.storage,
      () => readMailSettings(this.env),
      sendGmail
    )
  }

  private async scheduleMail(): Promise<void> {
    if (this.env.MAIL_MODE === 'disabled') return
    await scheduleNextMail(this.signups, this.ctx.storage)
  }
}

export default {
  fetch(request, env): Promise<Response> {
    const id = env.FROST_VOTES.idFromName('frost-early-signup-v1')
    const signups = env.FROST_VOTES.get(id)
    return handleSignupRequest(
      request,
      signups,
      env.ALLOWED_ORIGINS.split(',').map(value => value.trim())
    )
  }
} satisfies ExportedHandler<Env>
