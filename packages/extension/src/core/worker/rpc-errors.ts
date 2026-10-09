import { TimeoutError } from '../../lib/async-utils'

export interface WorkerRpcErrorResponse {
  error: string
  errorType?: 'timeout'
}

export function encodeWorkerRpcError(error: unknown): WorkerRpcErrorResponse {
  return {
    error: error instanceof Error ? error.message : 'Worker RPC routing failed',
    ...(error instanceof TimeoutError ? { errorType: 'timeout' } : {})
  }
}

export function decodeWorkerRpcError(response: WorkerRpcErrorResponse): Error {
  return response.errorType === 'timeout'
    ? new TimeoutError(response.error)
    : new Error(response.error)
}
