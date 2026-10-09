import {
  decodeBlockHeight,
  encodeBlockRangeRequest,
  encodeGrpcWebRequest,
  encodeIronwoodSubtreeRootsRequest,
  parseGrpcWebResponse
} from './grpc-web'
import type { CheckName, ProbeResult, RpcTarget } from './types'
import { getMonitorTargets } from './registry'

const SERVICE_PATH = '/cash.z.wallet.sdk.rpc.CompactTxStreamer/'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const FAILURE_RETRY_COUNT = 2

const CHECK_TIMEOUTS: Record<CheckName, number> = {
  GetLatestBlock: 8_000,
  GetBlockRange: 12_000,
  GetSubtreeRoots: 20_000
}

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface RpcResponse {
  dataFrames: Uint8Array[]
}

type CheckRunner = (operation: () => Promise<ProbeResult>) => Promise<ProbeResult>

const runImmediately: CheckRunner = operation => operation()

export interface ProbeTimeouts {
  GetLatestBlock: number
  GetBlockRange: number
  GetSubtreeRoots: number
}

export function getRpcTargets(): RpcTarget[] {
  return getMonitorTargets().map(target => ({
    ...target,
    url: validateRpcUrl(target.url, `${target.chainId}:${target.id}`)
  }))
}

export async function probeAllTargets(
  targets: RpcTarget[],
  fetchFunction: FetchFunction = fetch,
  timeouts: ProbeTimeouts = CHECK_TIMEOUTS
): Promise<ProbeResult[]> {
  const runSubtreeCheck = createSerialCheckRunner()
  const targetResults = await Promise.all(
    targets.map(target => probeTarget(target, fetchFunction, timeouts, runSubtreeCheck))
  )
  const targetsById = new Map(targets.map(target => [`${target.chainId}:${target.id}`, target]))

  return Promise.all(
    targetResults.flat().map(result => {
      if (result.outcome !== 'failure') return result
      const target = targetsById.get(`${result.chainId}:${result.targetId}`)
      if (!target) throw new Error(`Missing RPC target for ${result.chainId}:${result.targetId}`)
      return confirmFailure(target, result, fetchFunction, timeouts, runSubtreeCheck)
    })
  )
}

export async function probeTarget(
  target: RpcTarget,
  fetchFunction: FetchFunction = fetch,
  timeouts: ProbeTimeouts = CHECK_TIMEOUTS,
  runSubtreeCheck: CheckRunner = runImmediately
): Promise<ProbeResult[]> {
  const subtreePromise = probeCheck(
    target,
    'GetSubtreeRoots',
    undefined,
    fetchFunction,
    timeouts,
    runSubtreeCheck
  )
  const latest = await probeCheck(target, 'GetLatestBlock', undefined, fetchFunction, timeouts)

  let blockRange: ProbeResult
  if (latest.outcome === 'success' && latest.observedHeight !== undefined) {
    blockRange = await probeCheck(
      target,
      'GetBlockRange',
      latest.observedHeight,
      fetchFunction,
      timeouts
    )
  } else {
    blockRange = {
      chainId: target.chainId,
      chain: target.chain,
      network: target.network,
      targetId: target.id,
      targetLabel: target.label,
      check: 'GetBlockRange',
      outcome: 'skipped',
      attempts: 0,
      elapsedMs: 0,
      error: 'Skipped because GetLatestBlock failed'
    }
  }

  const subtree = await subtreePromise
  if (latest.observedHeight !== undefined) {
    subtree.observedHeight = latest.observedHeight
  }

  return [latest, blockRange, subtree]
}

async function confirmFailure(
  target: RpcTarget,
  initial: ProbeResult,
  fetchFunction: FetchFunction,
  timeouts: ProbeTimeouts,
  runSubtreeCheck: CheckRunner
): Promise<ProbeResult> {
  let elapsedMs = initial.elapsedMs
  let latest = initial

  for (let retry = 0; retry < FAILURE_RETRY_COUNT; retry += 1) {
    latest = await probeCheck(
      target,
      initial.check,
      initial.observedHeight,
      fetchFunction,
      timeouts,
      runSubtreeCheck
    )
    elapsedMs += latest.elapsedMs
    if (latest.outcome === 'success') {
      return { ...latest, attempts: retry + 2, elapsedMs }
    }
  }

  return { ...latest, attempts: FAILURE_RETRY_COUNT + 1, elapsedMs }
}

async function probeCheck(
  target: RpcTarget,
  check: CheckName,
  observedHeight: number | undefined,
  fetchFunction: FetchFunction,
  timeouts: ProbeTimeouts,
  runSubtreeCheck: CheckRunner = runImmediately
): Promise<ProbeResult> {
  if (check === 'GetLatestBlock') {
    return runCheck(target, check, async () => {
      const response = await requestRpc(
        target,
        check,
        new Uint8Array(),
        timeouts[check],
        fetchFunction
      )
      if (response.dataFrames.length !== 1) {
        throw new Error(`Expected one BlockID data frame, received ${response.dataFrames.length}`)
      }
      return decodeBlockHeight(response.dataFrames[0])
    })
  }

  if (check === 'GetBlockRange') {
    if (observedHeight === undefined) {
      throw new Error('GetBlockRange retry requires an observed height')
    }
    const rangeHeight = Math.max(1, observedHeight - 10)
    const result = await runCheck(target, check, async () => {
      const response = await requestRpc(
        target,
        check,
        encodeBlockRangeRequest(rangeHeight),
        timeouts[check],
        fetchFunction
      )
      if (response.dataFrames.length === 0) {
        throw new Error(`No compact block returned for height ${rangeHeight}`)
      }
      return observedHeight
    })
    if (result.observedHeight === undefined) result.observedHeight = observedHeight
    return result
  }

  const result = await runSubtreeCheck(() =>
    runCheck(target, check, async () => {
      await requestRpc(
        target,
        check,
        encodeIronwoodSubtreeRootsRequest(),
        timeouts[check],
        fetchFunction
      )
    })
  )
  if (observedHeight !== undefined) result.observedHeight = observedHeight
  return result
}

function createSerialCheckRunner(): CheckRunner {
  let tail: Promise<void> = Promise.resolve()

  return operation => {
    const result = tail.then(operation, operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

async function requestRpc(
  target: RpcTarget,
  method: CheckName,
  payload: Uint8Array,
  timeoutMs: number,
  fetchFunction: FetchFunction
): Promise<RpcResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFunction(`${target.url}${SERVICE_PATH}${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/grpc-web+proto',
        'x-grpc-web': '1'
      },
      body: encodeGrpcWebRequest(payload),
      redirect: 'manual',
      signal: controller.signal
    })

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!/^application\/grpc-web(?:\+proto)?(?:;|$)/.test(contentType)) {
      throw new Error(`Unexpected content type: ${contentType || 'missing'}`)
    }

    const body = await readResponseBody(response, MAX_RESPONSE_BYTES)
    const parsed = parseGrpcWebResponse(body)
    return { dataFrames: parsed.dataFrames }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function runCheck(
  target: RpcTarget,
  check: CheckName,
  operation: () => Promise<number | void>
): Promise<ProbeResult> {
  const startedAt = Date.now()
  try {
    const observedHeight = await operation()
    return {
      chainId: target.chainId,
      chain: target.chain,
      network: target.network,
      targetId: target.id,
      targetLabel: target.label,
      check,
      outcome: 'success',
      attempts: 1,
      elapsedMs: Date.now() - startedAt,
      ...(observedHeight === undefined ? {} : { observedHeight })
    }
  } catch (error) {
    return {
      chainId: target.chainId,
      chain: target.chain,
      network: target.network,
      targetId: target.id,
      targetLabel: target.label,
      check,
      outcome: 'failure',
      attempts: 1,
      elapsedMs: Date.now() - startedAt,
      error: safeErrorMessage(error)
    }
  }
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error('Missing response body')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.length
      if (totalBytes > maxBytes) {
        throw new Error(`Response exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return body
}

function validateRpcUrl(value: string, variableName: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid URL`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${variableName} must use HTTPS`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${variableName} must not contain credentials, a query, or a fragment`)
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${variableName} must not contain a path`)
  }
  return url.origin
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}
