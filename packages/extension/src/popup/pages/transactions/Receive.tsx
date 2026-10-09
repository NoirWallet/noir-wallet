import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { CopyToast, useCopyToClipboard } from '../../components/common/CopyToast'
import { Tooltip } from '../../components/ui/tooltip'
import { useWalletStore } from '@/store/wallet-store'
import { formatSortAddress } from '@/lib/format'
import { getAccountAddresses } from '@/core/wallet/account-manager'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'

import { type AddressType } from '@/types/wallet'
import { AddressTypeLabel } from '../../components/account/AddressType'
import {
  ShieldedAddressHistoryButton,
  ShieldedAddressHistorySheet
} from '../../components/transaction/ShieldedAddressHistorySheet'
import { useShieldedAddressActions } from '../../hooks/useShieldedAddressActions'

const ROTATE_SHIELDED_TOOLTIP =
  'Generate a new shielded receiving address. Funds sent to your previous address can still be received after sync.'

interface AddressOption {
  type: AddressType
  address: string
}

function parseAddressTypeParam(value: string | null): AddressType | null {
  if (value === 'shielded' || value === 'transparent') return value
  return null
}

export function Receive() {
  const [searchParams] = useSearchParams()
  const [addressType, setAddressType] = useState<AddressType>(
    () => parseAddressTypeParam(searchParams.get('type')) ?? 'shielded'
  )
  const { copyToClipboard, showToast } = useCopyToClipboard()
  const wallets = useWalletStore(state => state.wallets)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const walletId = searchParams.get('walletId') || currentWalletId
  const accountId = searchParams.get('accountId') || currentAccountId
  const currentAccount =
    wallets
      .find(wallet => wallet.id === walletId)
      ?.accounts.find(account => account.id === accountId) ?? null
  const shieldedActions = useShieldedAddressActions({ walletId, accountId })

  useEffect(() => {
    const fromUrl = parseAddressTypeParam(searchParams.get('type'))
    if (fromUrl) setAddressType(fromUrl)
  }, [searchParams])

  const addresses = getAccountAddresses(currentAccount, null)

  const addressOptions: AddressOption[] = addresses.map(a => ({
    type: a.type,
    address: a.address
  }))

  const currentAddress = addressOptions.find(a => a.type === addressType)?.address || ''

  const handleCopy = useCallback(
    (address: string, type: AddressType) => {
      copyToClipboard(address)
      sendAnalyticsEvent(ANALYTICS_EVENTS.ADDRESS_COPIED, {
        pageId: PAGE_IDS.RECEIVE,
        extra: { address_type: type }
      })
    },
    [copyToClipboard]
  )

  if (!currentAccount) {
    return (
      <div className="page-container">
        <PageHeader title="Receive" showBack />
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
        title="Receive"
        showBack
        rightContent={
          <ShieldedAddressHistoryButton
            onClick={() => shieldedActions.setHistoryOpen(true)}
            disabled={shieldedActions.isLocked}
          />
        }
      />

      <div className="page-content">
        <div className="flex flex-col items-center mb-6">
          <div className="w-56 h-56 bg-white rounded-2xl p-4 mb-4">
            {currentAddress ? (
              <QRCodeSVG
                value={currentAddress}
                size={192}
                level="H"
                includeMargin={false}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded">
                <p className="text-sm text-gray-400">No address</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <AddressTypeLabel type={addressType} />
          </div>
        </div>

        {shieldedActions.rotateError && (
          <p className="text-xs text-danger mb-3 px-1" role="alert">
            {shieldedActions.rotateError}
          </p>
        )}

        <div className="space-y-3 mb-4">
          {addressOptions.map(addr => (
            <AddressCard
              key={addr.type}
              type={addr.type}
              address={addr.address}
              isSelected={addressType === addr.type}
              onSelect={() => setAddressType(addr.type)}
              onCopy={e => {
                e.stopPropagation()
                handleCopy(addr.address, addr.type)
              }}
              onRotate={
                addr.type === 'shielded' ? shieldedActions.rotateShieldedAddress : undefined
              }
              isRotating={addr.type === 'shielded' && shieldedActions.isRotating}
              canRotate={addr.type === 'shielded' ? shieldedActions.canRotate : false}
            />
          ))}
        </div>
      </div>

      <div className="page-footer">
        <Button onClick={() => handleCopy(currentAddress, addressType)} className="w-full h-[45px]">
          Copy Address
        </Button>
      </div>

      <ShieldedAddressHistorySheet
        open={shieldedActions.historyOpen}
        onOpenChange={shieldedActions.setHistoryOpen}
        addresses={shieldedActions.history}
        currentAddress={currentAccount.addresses.shielded}
        loading={shieldedActions.historyLoading}
        error={shieldedActions.historyError}
        selectingAddress={shieldedActions.selectingAddress}
        onRetry={shieldedActions.loadHistory}
        onSelect={shieldedActions.selectHistoryAddress}
        onCopy={address => handleCopy(address, 'shielded')}
      />
    </div>
  )
}

interface AddressCardProps {
  type: AddressType
  address: string
  isSelected: boolean
  onSelect: () => void
  onCopy: (e: React.MouseEvent) => void
  onRotate?: () => void
  isRotating?: boolean
  canRotate?: boolean
}

function AddressCard({
  type,
  address,
  isSelected,
  onSelect,
  onCopy,
  onRotate,
  isRotating,
  canRotate
}: AddressCardProps) {
  return (
    <div
      className={`w-full p-4 rounded-2xl transition-all cursor-pointer text-left ${
        isSelected
          ? 'bg-card border-2 border-primary'
          : 'bg-card/50 border-2 border-transparent hover:bg-card/70'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2 mb-2">
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                isSelected ? 'border-primary' : 'border-white/30'
              }`}
            >
              {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <span className="font-mono text-sm text-white/90">{formatSortAddress(address)}</span>
          </div>
          <div className="flex items-center gap-2">
            <AddressTypeLabel type={type} />
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {onRotate && (
            <Tooltip content={ROTATE_SHIELDED_TOOLTIP} className="max-w-[240px]">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onRotate()
                }}
                disabled={!canRotate}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Generate new shielded address"
              >
                <Icon
                  icon="lucide:refresh-cw"
                  width={16}
                  height={16}
                  className={`text-muted ${isRotating ? 'animate-spin' : ''}`}
                />
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Icon icon="lucide:copy" width={16} height={16} className="text-muted" />
          </button>
        </div>
      </div>
      {type === 'shielded' && (
        <div className="mt-2 w-full text-xs text-muted">
          🔒 Shielded addresses provide enhanced privacy for your transactions.
        </div>
      )}
    </div>
  )
}
