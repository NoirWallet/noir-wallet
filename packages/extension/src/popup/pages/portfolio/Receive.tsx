import { useSearchParams } from 'react-router-dom'
import { AddressesList } from '@/popup/pages/account/AddressesList'
import { PageHeader } from '@/popup/components/common/PageHeader'
import { TransactionNotice } from '@/popup/components/transaction/TransactionNotice'
import { ListSkeleton } from '@/popup/components/ui/skeleton'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { EnglishCopy, useTranslation } from '@/popup/i18n'
import { portfolioMessages } from '@/popup/i18n/portfolio-messages'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { ShieldReceive } from './ShieldReceive'
import { useWalletStore } from '@/store/wallet-store'

export function Receive() {
  const [params] = useSearchParams()
  const walletId = params.get('walletId')
  const accountId = params.get('accountId')
  if (params.get('mode') !== 'shield') {
    return walletId === null && accountId === null ? (
      <ActivePublicReceive />
    ) : (
      <AddressesList receive />
    )
  }
  return (
    <EnglishCopy>
      <ShieldReceive />
    </EnglishCopy>
  )
}

function ActivePublicReceive() {
  const { t } = useTranslation(portfolioMessages)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const { activeAccount, loading, error, contextChanging, refresh } = useActiveAccountNetworks()
  const effective = resolveEffectiveActiveAccountIdentity({
    currentWalletId,
    currentAccountId,
    nativeAccount: activeAccount
  })
  if (effective && !contextChanging) {
    return (
      <AddressesList
        key={`${effective.walletId}:${effective.accountId}`}
        receive
        receiveAccount={effective}
      />
    )
  }

  return (
    <div className="page-container">
      <PageHeader title={t('address')} showBack />
      <div className="px-4 py-6 text-center text-sm text-muted">
        {error ? (
          <TransactionNotice
            message={t('receiveLoadAddressesFailed')}
            retryLabel={t('tryAgain')}
            onRetry={() => void refresh()}
          />
        ) : loading || contextChanging ? (
          <ListSkeleton rows={4} label={t('loadingAddresses')} card />
        ) : (
          <p role="status">{t('noAccount')}</p>
        )}
      </div>
    </div>
  )
}
