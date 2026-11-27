import { ZcashRecoveryContent } from '../components/account/ZcashRecoveryContent'
import { openModal } from '../provider/ModalManager'
import { useNavigate } from '../provider/Router'

export function useResyncZcash() {
  const { navigate } = useNavigate()

  return async (
    walletId: string,
    accountId: string,
    birthdayHeight: number,
    options?: { recovery?: boolean }
  ) => {
    const destination = await openModal<string | undefined>({
      title: options?.recovery ? 'Restore Zcash' : 'Resync Zcash',
      className: 'gap-5 px-5 pt-6 pb-4 [&_[data-slot=dialog-header]]:text-left',
      body: (resolve, close) => (
        <ZcashRecoveryContent
          walletId={walletId}
          accountId={accountId}
          birthdayHeight={birthdayHeight}
          recovery={options?.recovery}
          onNavigate={resolve}
          close={close}
        />
      )
    })
    if (destination) navigate(destination)
  }
}
