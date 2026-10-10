import { DurableObject } from 'cloudflare:workers'
import { handleVoteRequest } from './api'
import { VoteStore, type VoteSnapshot, type VoteChoice } from './vote-store'

interface Env {
  FROST_VOTES: DurableObjectNamespace<FrostVotes>
  ALLOWED_ORIGINS: string
}

export class FrostVotes extends DurableObject<Env> {
  private readonly votes: VoteStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.votes = new VoteStore(ctx.storage)
  }

  async read(voterHash?: string): Promise<VoteSnapshot> {
    return this.votes.read(voterHash)
  }

  async cast(voterHash: string, choice: VoteChoice): Promise<VoteSnapshot> {
    return this.votes.cast(voterHash, choice)
  }
}

export default {
  fetch(request, env): Promise<Response> {
    const id = env.FROST_VOTES.idFromName('frost-v1')
    const votes = env.FROST_VOTES.get(id)
    return handleVoteRequest(
      request,
      votes,
      env.ALLOWED_ORIGINS.split(',').map(value => value.trim())
    )
  }
} satisfies ExportedHandler<Env>
