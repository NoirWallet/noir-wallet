import { test as it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { KeyedTaskCoordinator } from '../src/lib/keyed-task-coordinator.ts'

describe('Keyed task coordinator', () => {
  it('shares one in-flight task for concurrent requests with the same key', async () => {
    const coordinator = new KeyedTaskCoordinator()
    let executions = 0
    let release
    const gate = new Promise(resolve => {
      release = resolve
    })

    const first = coordinator.run('wallet-1', async () => {
      executions++
      await gate
      return 'completed'
    })
    const second = coordinator.run('wallet-1', async () => {
      executions++
      return 'failed'
    })

    assert.strictEqual(first, second)
    assert.equal(coordinator.size, 1)
    release()
    assert.equal(await second, 'completed')
    assert.equal(executions, 1)
    assert.equal(coordinator.size, 0)
  })

  it('allows a new task after the prior task settles', async () => {
    const coordinator = new KeyedTaskCoordinator()
    let executions = 0

    await coordinator.run('wallet-1', async () => ++executions)
    const result = await coordinator.run('wallet-1', async () => ++executions)

    assert.equal(result, 2)
    assert.equal(executions, 2)
  })
})
