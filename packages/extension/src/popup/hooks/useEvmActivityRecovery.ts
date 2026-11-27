import { useLayoutEffect, useRef, useState } from 'react'
import type { ActivityItem } from '@/core/activity'
import type { EvmNonceRecoveryState } from '@/infrastructure/chains/evm'
import { openMultichainHardwareSignTab } from '@/lib/hardware-tab'
import {
  EvmWalletClientError,
  evmWalletClient,
  type EvmTransferReview
} from '@/popup/services/evm-wallet-client'
import {
  getRecoverableEvmActivity,
  readEvmActivityRecoveryReview,
  wasEvmActivityBroadcast,
  type EvmActivityRecoveryTarget
} from '@/popup/services/evm-activity-recovery'

type QueueCheck = {
  readonly recovery: EvmNonceRecoveryState | null
  readonly pending: readonly ActivityItem[]
  readonly unavailable: boolean
}

type RecoveryReview = NonNullable<ReturnType<typeof readEvmActivityRecoveryReview>>

type QueueAction = 'check' | 'retry' | 'prepare' | 'approve'

function rejectReview(review: EvmTransferReview) {
  return evmWalletClient.rejectTransfer(review.graph.root.id).catch(() => {})
}

export function useEvmActivityRecovery(target: EvmActivityRecoveryTarget) {
  const { chainId, executionMode } = target
  const [queue, setQueue] = useState<QueueCheck | null>(null)
  const [review, setReview] = useState<RecoveryReview | null>(null)
  const [busy, setBusy] = useState<QueueAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const operation = useRef<QueueAction | null>(null)
  const pendingReview = useRef<EvmTransferReview | null>(null)
  const lifetime = useRef<object | null>(null)

  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
      operation.current = null
      const pending = pendingReview.current
      pendingReview.current = null
      if (pending) void rejectReview(pending)
    }
  }, [])

  const run = async (action: QueueAction, perform: (isCurrent: () => boolean) => Promise<void>) => {
    const instance = lifetime.current
    if (!instance || operation.current) return
    const isCurrent = () => lifetime.current === instance
    operation.current = action
    setBusy(action)
    setError(null)
    setOutcome(null)
    try {
      await perform(isCurrent)
    } catch (cause) {
      if (isCurrent()) {
        setQueue(null)
        setError(
          cause instanceof EvmWalletClientError && cause.code === 'insufficient-funds'
            ? 'Not enough funds for the network fee.'
            : 'Unable to continue recovery. Check the transaction queue again.'
        )
      }
    } finally {
      if (isCurrent()) {
        operation.current = null
        setBusy(null)
      }
    }
  }

  const readQueue = () => evmWalletClient.getNonceRecovery(chainId, executionMode)
  const readLocalActivity = () =>
    evmWalletClient.getActivity('read', executionMode, { chainIds: [chainId] })

  const reportCompletedRetry = async (transactionId: string, isCurrent: () => boolean) => {
    const model = await readLocalActivity().catch(() => null)
    if (!isCurrent() || !model || !wasEvmActivityBroadcast(model.items, target, transactionId)) {
      return false
    }
    setQueue(null)
    setOutcome('Transaction broadcast.')
    return true
  }

  const check = () =>
    run('check', async isCurrent => {
      setQueue(null)
      const [recovery, activity] = await Promise.allSettled([readQueue(), readLocalActivity()])
      if (!isCurrent()) return
      setQueue({
        recovery: recovery.status === 'fulfilled' ? recovery.value : null,
        pending:
          activity.status === 'fulfilled' && activity.value
            ? getRecoverableEvmActivity(activity.value.items, target)
            : [],
        unavailable: recovery.status === 'rejected'
      })
    })

  const retry = () =>
    run('retry', async isCurrent => {
      const expected = queue?.recovery
      if (expected?.action !== 'retry-broadcast' || !expected.transactionId) return
      const transactionId = expected.transactionId
      const next = await readQueue()
      if (!isCurrent()) return
      if (
        next?.action !== 'retry-broadcast' ||
        next.pendingNonce !== expected.pendingNonce ||
        next.transactionId !== transactionId
      ) {
        const broadcast = await reportCompletedRetry(transactionId, isCurrent)
        if (!broadcast && isCurrent()) {
          setQueue(null)
          setError('The transaction queue changed. Check it again.')
        }
        return
      }
      const submission = await evmWalletClient.resumeTransfer(transactionId).catch(async error => {
        if (isCurrent() && (await reportCompletedRetry(transactionId, isCurrent))) return null
        throw error
      })
      if (!submission || !isCurrent()) return
      setQueue(null)
      setOutcome(
        submission.status === 'broadcast'
          ? 'Transaction broadcast.'
          : 'Transaction is still waiting to be broadcast.'
      )
    })

  const prepare = () =>
    run('prepare', async isCurrent => {
      const expected = queue?.recovery
      if (expected?.action !== 'fill-gap') return
      const next = await readQueue()
      if (!isCurrent()) return
      if (next?.action !== 'fill-gap' || next.pendingNonce !== expected.pendingNonce) {
        setQueue(null)
        setError('The transaction queue changed. Check it again.')
        return
      }
      const transfer = await evmWalletClient.prepareNonceRecovery(chainId, executionMode)
      const details = readEvmActivityRecoveryReview(transfer, target, expected.pendingNonce)
      if (!isCurrent() || !details) {
        await rejectReview(transfer)
        if (isCurrent()) {
          setQueue(null)
          setError('The recovery review changed. Check the transaction queue again.')
        }
        return
      }
      pendingReview.current = transfer
      setReview(details)
    })

  const back = () => {
    if (operation.current || !pendingReview.current) return
    const transfer = pendingReview.current
    pendingReview.current = null
    setReview(null)
    setQueue(null)
    void rejectReview(transfer)
  }

  const approve = () =>
    run('approve', async isCurrent => {
      const transfer = pendingReview.current
      if (!transfer) return
      pendingReview.current = null
      setReview(null)
      setQueue(null)
      if (transfer.review.expiresAt <= Date.now()) {
        await rejectReview(transfer)
        if (isCurrent()) setError('The review expired. Check the transaction queue again.')
        return
      }
      try {
        const submission = await evmWalletClient.approveTransfer(
          transfer.graph.root.id,
          transfer.review.payloadFingerprint.digestHex
        )
        if (submission.status === 'external-signature-required') {
          if (!isCurrent()) {
            await rejectReview(transfer)
            return
          }
          await openMultichainHardwareSignTab(submission.transactionId, 'evm')
          if (isCurrent()) window.close()
        } else if (isCurrent()) {
          setOutcome(
            submission.status === 'broadcast'
              ? 'Recovery transaction broadcast.'
              : 'Recovery transaction is waiting to be broadcast.'
          )
        }
      } catch (cause) {
        await rejectReview(transfer)
        throw cause
      }
    })

  return { queue, review, busy, error, outcome, check, retry, prepare, back, approve }
}
