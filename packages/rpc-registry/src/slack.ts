import type { PlannedNotification } from './alert-state'

const SLACK_TIMEOUT_MS = 5_000

export type SlackFetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface SlackPayload {
  text: string
  blocks: Array<{
    type: 'section'
    text: { type: 'mrkdwn'; text: string }
  }>
}

const COPY = {
  opened: {
    level: 'ERROR',
    state: 'open'
  },
  reminder: {
    level: 'WARN',
    state: 'ongoing'
  },
  recovery: {
    level: 'INFO',
    state: 'recovered'
  }
} as const

export function formatSlackNotification(
  notification: PlannedNotification,
  generatedAt: number
): SlackPayload {
  const copy = COPY[notification.kind]
  const utcTime = new Date(generatedAt).toISOString()
  const lines = notification.items.map(item => {
    const elapsed = item.elapsedMs === undefined ? 'unknown' : `${item.elapsedMs}ms`
    const height = item.lastHeight === undefined ? 'unknown' : String(item.lastHeight)
    const attempts = item.attempts === undefined ? 'unknown' : String(item.attempts)
    const error =
      notification.kind === 'recovery'
        ? ''
        : ` error=${formatLogValue(item.error ?? 'Unknown RPC failure')}`

    return `${utcTime} level=${copy.level} state=${copy.state} chain=${formatLogValue(item.chainId)} provider=${formatLogValue(item.targetLabel)} method=${item.check} attempts=${attempts} elapsed=${elapsed} height=${height}${error}`
  })
  const text = lines.join('\n')

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`\n${escapeMrkdwn(text)}\n\`\`\`` }
      }
    ]
  }
}

export async function sendSlackNotification(
  webhookUrl: string,
  notification: PlannedNotification,
  generatedAt: number,
  fetchFunction: SlackFetchFunction = fetch
): Promise<void> {
  const validatedUrl = validateSlackWebhookUrl(webhookUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS)

  try {
    const response = await fetchFunction(validatedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(formatSlackNotification(notification, generatedAt)),
      redirect: 'manual',
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Slack webhook returned HTTP ${response.status}`)
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Slack webhook timed out after ${SLACK_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function validateSlackWebhookUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SLACK_WEBHOOK_URL must be a valid URL')
  }

  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com') {
    throw new Error('SLACK_WEBHOOK_URL must be an HTTPS hooks.slack.com URL')
  }
  if (!url.pathname.startsWith('/services/')) {
    throw new Error('SLACK_WEBHOOK_URL must be a Slack Incoming Webhook URL')
  }
  return url.toString()
}

function escapeMrkdwn(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function formatLogValue(value: string): string {
  const sanitized = truncate(value.replaceAll('`', "'").replace(/\s+/g, ' ').trim(), 180)
  return JSON.stringify(sanitized)
}
