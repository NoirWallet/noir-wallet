import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { DialogTitle } from '../ui/dialog'
import { MultichainActivityDetail } from './MultichainActivityDetail'
import { openModal } from '@/popup/provider/ModalManager'
import { evmWalletClient } from '@/popup/services/evm-wallet-client'
import { useWalletStore } from '@/store/wallet-store'
import type { ActivityItem } from '@/core/activity'
import type { Network } from '@/types'

interface ConfidentialActivityTarget {
  readonly network: Network
  readonly keyDomainId: string
  readonly accountId: string
  readonly transactionId: string
}

interface ConfidentialActivitySheetProps {
  readonly plan: ConfidentialActivityTarget
  readonly onDone: () => void
  readonly onViewActivity: () => void
}

function ConfidentialActivitySheet({
  plan,
  onDone,
  onViewActivity
}: ConfidentialActivitySheetProps) {
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const [activity, setActivity] = useState<ActivityItem | null>(null)
  const [stillLoading, setStillLoading] = useState(false)
  const matchesAccount =
    currentNetwork === plan.network &&
    currentWalletId === plan.keyDomainId &&
    currentAccountId === plan.accountId

  useEffect(() => {
    if (!matchesAccount) {
      onDone()
      return
    }
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const delayTimer = setTimeout(() => {
      if (active) setStillLoading(true)
    }, 10_000)

    const load = async () => {
      try {
        const model = await evmWalletClient.getActivity('read', 'all')
        const item = model?.items.find(candidate => candidate.id === plan.transactionId)
        if (
          active &&
          model?.scope.keyDomainId === plan.keyDomainId &&
          model.scope.accountId === plan.accountId &&
          item?.scope.keyDomainId === plan.keyDomainId &&
          item.scope.accountId === plan.accountId
        ) {
          setActivity(item)
          return
        }
      } catch {
        // The local activity projection may lag a newly started transfer.
      }
      if (active) retryTimer = setTimeout(() => void load(), 3_000)
    }
    void load()
    return () => {
      active = false
      clearTimeout(delayTimer)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [matchesAccount, onDone, plan.accountId, plan.keyDomainId, plan.transactionId])

  return (
    <>
      <DialogTitle className="sr-only">Transaction activity</DialogTitle>
      <div className="min-h-0 overflow-y-auto px-5 pb-4 pt-5">
        {activity ? (
          <MultichainActivityDetail item={activity} network={plan.network} onClose={onDone} />
        ) : (
          <div role="status" className="py-8 text-center text-sm text-muted">
            Loading transaction...
          </div>
        )}
        {!activity && stillLoading && (
          <Button
            variant="outline"
            className="mt-3 h-[45px] w-full"
            onClick={() => {
              onDone()
              onViewActivity()
            }}
          >
            View Activity
          </Button>
        )}
      </div>
      <div className="px-5 pb-5 pt-2">
        <Button onClick={onDone} className="h-[45px] w-full">
          Done
        </Button>
      </div>
    </>
  )
}

export function openConfidentialActivity(
  plan: ConfidentialActivityTarget,
  onViewActivity: () => void
): Promise<void> {
  return openModal<void>({
    className: 'max-h-[calc(100dvh-1rem)] grid-rows-[minmax(0,1fr)_auto] gap-0 p-0',
    body: resolve => (
      <ConfidentialActivitySheet plan={plan} onDone={resolve} onViewActivity={onViewActivity} />
    )
  })
}
