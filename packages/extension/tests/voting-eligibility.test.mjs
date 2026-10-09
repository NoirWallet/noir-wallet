import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canResumeVoting,
  getVotingDiscoveryErrorMessage,
  parseVotingDate,
  supportsVotingKeySource
} from '../src/lib/voting.ts'

test('voting timestamps accept Unix seconds from authenticated round data', () => {
  assert.equal(parseVotingDate('1789412400').getTime(), 1_789_412_400_000)
  assert.equal(parseVotingDate('2026-09-14T00:00:00Z').toISOString(), '2026-09-14T00:00:00.000Z')
})

test('only interrupted voting phases offer recovery', () => {
  assert.equal(canResumeVoting({ phase: 'delegation_pending' }), true)
  assert.equal(canResumeVoting({ phase: 'vote_confirmed' }), true)
  assert.equal(canResumeVoting({ phase: 'shares_confirmed' }), false)
  assert.equal(canResumeVoting(null), false)
})

test('Keystone accounts cannot enter voting while software accounts can', () => {
  assert.equal(supportsVotingKeySource('software'), true)
  assert.equal(supportsVotingKeySource(undefined), true)
  assert.equal(supportsVotingKeySource('keystone'), false)
})

test('only rejected rounds show an authenticity error; an empty discovery shows the empty state', () => {
  assert.equal(getVotingDiscoveryErrorMessage({ accepted: [], rejected: [] }), null)
  assert.notEqual(
    getVotingDiscoveryErrorMessage({
      accepted: [],
      rejected: [{ roundId: 'invalid', code: 'ROUND_UNAUTHENTICATED', message: 'Invalid round' }]
    }),
    null
  )
})
