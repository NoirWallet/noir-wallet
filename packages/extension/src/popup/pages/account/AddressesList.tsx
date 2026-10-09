import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { CopyToast, useCopyToClipboard } from '../../components/common/CopyToast'
import {
  ShieldedAddressHistoryButton,
  ShieldedAddressHistorySheet
} from '../../components/transaction/ShieldedAddressHistorySheet'
import { Tooltip } from '../../components/ui/tooltip'
import { useNavigate } from '../../provider/Router'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { AddressTypeLabel } from '../../components/account/AddressType'
import { type AddressType } from '@/types/wallet'

import { formatPrice } from '@/lib/format'
import { accountManager, getAccountAddresses } from '@/core/wallet/account-manager'
import { canShieldTransparentFunds } from '@/core/zcash/shielding'
import { useShieldFunds } from '../../hooks/useShieldFunds'
import { useShieldedAddressActions } from '../../hooks/useShieldedAddressActions'
import { zeroZcashBalance } from '@/core/wallet/balance-summary'
import { getTransparentAddressPath, getZip32AccountPath } from '@/lib/zcash-derivation'

const ROTATE_SHIELDED_TOOLTIP =
  'Generate a new shielded receiving address. Funds sent to your previous address can still be received after sync.'

export function AddressesList() {
  const { navigate } = useNavigate()
  const { copyToClipboard, showToast } = useCopyToClipboard()
  const [searchParams] = useSearchParams()
  const paramAccountId = searchParams.get('accountId')
  const paramWalletId = searchParams.get('walletId')

  const { zecPrice, currentNetwork, wallets, currentWalletId, currentAccountId } = useWalletStore()
  const { getBalance } = useAccountDataStore()
  const { isShielding, handleShieldFunds, shieldSheet } = useShieldFunds()

  const wid = paramWalletId || currentWalletId
  const aid = paramAccountId || currentAccountId
  const shieldedActions = useShieldedAddressActions({ walletId: wid, accountId: aid })

  const account = useMemo(() => {
    if (!wid || !aid) return null
    const wallet = wallets.find(w => w.id === wid)
    return wallet?.accounts.find(a => a.id === aid) || null
  }, [wid, aid, wallets])

  const balance = useMemo(() => {
    if (!wid || !aid) return null
    return getBalance(currentNetwork, wid, aid)
  }, [wid, aid, currentNetwork, getBalance])

  const displayBalance = balance || zeroZcashBalance()
  const addresses = getAccountAddresses(account, displayBalance, zecPrice)
  const canShield = canShieldTransparentFunds(balance)

  useEffect(() => {
    if (!wid || !aid || accountManager.isLocked()) return
    void accountManager.refreshAccountAddresses(wid, aid).catch(() => {})
  }, [wid, aid])

  const showAddressQrCode = (type: AddressType) => {
    if (!wid || !aid) return
    const params = new URLSearchParams({ type, walletId: wid, accountId: aid })
    navigate(`/receive?${params.toString()}`)
  }

  if (!account) {
    return (
      <div className="page-container">
        <PageHeader title="Addresses" showBack />
        <div className="flex-1 flex items-center justify-center px-5">
          <p className="text-muted text-center">No account available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <CopyToast show={showToast} />
      <PageHeader
        title="Addresses"
        showBack
        rightContent={
          <ShieldedAddressHistoryButton
            onClick={() => shieldedActions.setHistoryOpen(true)}
            disabled={shieldedActions.isLocked}
          />
        }
      />

      <div className="page-content">
        <p className="text-sm text-muted mb-4">{addresses.length} addresses</p>

        {shieldedActions.rotateError && (
          <p className="text-xs text-danger mb-3" role="alert">
            {shieldedActions.rotateError}
          </p>
        )}

        <div className="space-y-4">
          {addresses.map((item, index) => (
            <div key={index} className="p-4 bg-card rounded-xl">
              <div className="mb-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <AddressTypeLabel type={item.type as AddressType} />
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip content={`Show ${item.type} address QR code`}>
                      <button
                        type="button"
                        onClick={() => showAddressQrCode(item.type as AddressType)}
                        className="rounded-lg p-2 text-muted transition-colors hover:bg-white/10 hover:text-white"
                        aria-label={`Show ${item.type} address QR code`}
                      >
                        <Icon icon="lucide:qr-code" width={16} height={16} />
                      </button>
                    </Tooltip>

                    {item.type === 'shielded' && (
                      <Tooltip content={ROTATE_SHIELDED_TOOLTIP} className="max-w-[240px]">
                        <button
                          type="button"
                          onClick={shieldedActions.rotateShieldedAddress}
                          disabled={!shieldedActions.canRotate}
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Generate new shielded address"
                        >
                          <Icon
                            icon="lucide:refresh-cw"
                            width={16}
                            height={16}
                            className={shieldedActions.isRotating ? 'animate-spin' : undefined}
                          />
                        </button>
                      </Tooltip>
                    )}

                    <button
                      type="button"
                      onClick={() => copyToClipboard(item.address)}
                      className="rounded-lg p-2 text-muted transition-colors hover:bg-white/10 hover:text-white"
                      aria-label={`Copy ${item.type} address`}
                    >
                      <Icon icon="lucide:copy" width={16} height={16} />
                    </button>
                  </div>
                </div>
                <p className="w-full break-all font-mono text-xs text-muted">{item.address}</p>
              </div>
              <div className="flex justify-between text-sm border-t border-white/10 pt-3">
                <span className="text-muted">Balance</span>
                <div className="text-right">
                  <p className="font-medium">{item.balanceFormatted}</p>
                  <p className="text-xs text-muted">
                    {formatPrice(item.fiatValue, { showSign: true })}
                  </p>
                </div>
              </div>

              {/* Shield Button for Transparent Address */}
              {item.type === 'transparent' && canShield && (
                <button
                  onClick={handleShieldFunds}
                  disabled={isShielding}
                  className="w-full mt-3 py-2 px-4 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                >
                  <Icon icon="lucide:shield" width={14} height={14} />
                  <span>{isShielding ? 'Shielding...' : 'Transfer to Shielded Address'}</span>
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="mb-3 text-xs text-muted">Derivation paths</p>
          <div className="space-y-3">
            <DerivationPathRow
              label="Account derivation path"
              description="Used to derive this Zcash account"
              value={getZip32AccountPath(currentNetwork, account.derivationIndex)}
              onCopy={copyToClipboard}
            />
            {account.addresses.transparentAddressIndex !== undefined && (
              <DerivationPathRow
                label="Transparent address derivation path"
                description="Used to derive the primary transparent address"
                value={getTransparentAddressPath(
                  currentNetwork,
                  account.derivationIndex,
                  account.addresses.transparentAddressIndex
                )}
                onCopy={copyToClipboard}
              />
            )}
          </div>
        </div>
      </div>

      {shieldSheet}
      <ShieldedAddressHistorySheet
        open={shieldedActions.historyOpen}
        onOpenChange={shieldedActions.setHistoryOpen}
        addresses={shieldedActions.history}
        currentAddress={account.addresses.shielded}
        loading={shieldedActions.historyLoading}
        error={shieldedActions.historyError}
        selectingAddress={shieldedActions.selectingAddress}
        onRetry={shieldedActions.loadHistory}
        onSelect={shieldedActions.selectHistoryAddress}
        onCopy={copyToClipboard}
      />
    </div>
  )
}

function DerivationPathRow({
  label,
  description,
  value,
  onCopy
}: {
  label: string
  description: string
  value: string
  onCopy: (value: string) => Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={() => void onCopy(value)}
      className="w-full rounded-xl bg-card px-4 py-3 text-left transition-colors hover:bg-white/5"
    >
      <span className="block text-sm text-white/90">{label}</span>
      <span className="mt-1 block text-xs text-muted">{description}</span>
      <span className="mt-1.5 flex items-center justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-xs text-muted">{value}</span>
        <Icon icon="lucide:copy" width={14} height={14} className="shrink-0 text-muted" />
      </span>
    </button>
  )
}
