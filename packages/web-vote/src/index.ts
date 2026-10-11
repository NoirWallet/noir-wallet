import { DurableObject } from 'cloudflare:workers'
import { handleSignupRequest } from './api'
import { SignupStore } from './signup-store'

interface Env {
  FROST_VOTES: DurableObjectNamespace<FrostVotes>
  ALLOWED_ORIGINS: string
}

// Preserve the deployed class and binding names while using a separate object for signups.
export class FrostVotes extends DurableObject<Env> {
  private readonly signups: SignupStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.signups = new SignupStore(ctx.storage.sql)
  }

  async register(email: string, createdAt: number): Promise<void> {
    this.signups.register(email, createdAt)
  }

  async ready(): Promise<void> {
    this.signups.ready()
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
