import { DurableObject } from 'cloudflare:workers'
import {
  advanceMonitorState,
  markNotificationSent,
  parseStoredSnapshot,
  type MonitorSnapshot
} from './alert-state'
import { getRpcTargets, probeAllTargets } from './probes'
import { sendSlackNotification } from './slack'
import type { ProbeResult } from './types'
import { handleRegistryRequest } from './api'

const STORAGE_KEY = 'monitor-snapshot-v2'
const COORDINATOR_NAME = 'rpc-registry'

interface Env {
  SLACK_WEBHOOK_URL: string
  MONITOR_COORDINATOR: DurableObjectNamespace<MonitorCoordinator>
}

export interface MonitorRunSummary {
  checkedAt: string
  results: ProbeResult[]
  notificationErrors: string[]
}

export class MonitorCoordinator extends DurableObject<Env> {
  private inFlight?: Promise<MonitorRunSummary>

  run(): Promise<MonitorRunSummary> {
    if (this.inFlight) return this.inFlight

    const run = this.execute()
    this.inFlight = run
    const clearInFlight = () => {
      if (this.inFlight === run) this.inFlight = undefined
    }
    void run.then(clearInFlight, clearInFlight)
    return run
  }

  private async execute(): Promise<MonitorRunSummary> {
    const checkedAt = Date.now()
    const targets = getRpcTargets()
    const results = await probeAllTargets(targets)
    const stored = await this.ctx.storage.get<unknown>(STORAGE_KEY)
    const transition = advanceMonitorState(parseStoredSnapshot(stored), results, checkedAt)
    let snapshot: MonitorSnapshot = transition.snapshot
    const notificationErrors: string[] = []

    await this.ctx.storage.put(STORAGE_KEY, snapshot)

    for (const notification of transition.notifications) {
      try {
        await sendSlackNotification(this.env.SLACK_WEBHOOK_URL, notification, checkedAt)
        snapshot = markNotificationSent(snapshot, notification, Date.now())
        await this.ctx.storage.put(STORAGE_KEY, snapshot)
      } catch (error) {
        const message = safeErrorMessage(error)
        notificationErrors.push(`${notification.kind}: ${message}`)
        console.error(
          JSON.stringify({
            event: 'slack_notification_failed',
            kind: notification.kind,
            checks: notification.items.map(item => `${item.targetId}:${item.check}`),
            error: message
          })
        )
      }
    }

    const summary = {
      checkedAt: new Date(checkedAt).toISOString(),
      results,
      notificationErrors
    }
    console.log(JSON.stringify({ event: 'rpc_monitor_run', ...summary }))
    return summary
  }
}

export default {
  fetch(request): Response {
    return handleRegistryRequest(request)
  },
  scheduled(_controller, env, ctx): void {
    const id = env.MONITOR_COORDINATOR.idFromName(COORDINATOR_NAME)
    const stub = env.MONITOR_COORDINATOR.get(id)
    ctx.waitUntil(stub.run().then(() => undefined))
  }
} satisfies ExportedHandler<Env>

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}
