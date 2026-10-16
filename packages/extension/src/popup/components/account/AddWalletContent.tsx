import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import {
  HARDWARE_CONNECT_OPTIONS,
  type HardwareConnectVendor
} from '@/lib/hardware-connect-options'
import { DialogHeader, DialogTitle } from '../ui/dialog'
import { HardwareWalletLogo } from '../hardware/HardwareWalletLogo'
import { WalletOptionButton } from './WalletOptionButton'
import { WALLET_OPTION_ICONS } from './wallet-option-icons'

export type AddWalletAction = 'import' | 'private-key' | 'create' | HardwareConnectVendor

export function AddWalletContent({ onSelect }: { onSelect: (action: AddWalletAction) => void }) {
  const [step, setStep] = useState<'wallet' | 'import' | 'hardware'>('wallet')
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  return (
    <>
      <DialogHeader className="relative flex h-8 flex-row items-center justify-center px-8">
        {step !== 'wallet' && (
          <button
            type="button"
            aria-label="Back to Add Wallet"
            onClick={() => setStep('wallet')}
            className="absolute left-0 flex size-8 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Icon icon={WALLET_OPTION_ICONS.back} width={18} height={18} aria-hidden="true" />
          </button>
        )}
        <DialogTitle ref={headingRef} tabIndex={-1} className="text-base outline-none">
          {step === 'import'
            ? 'Import Wallet'
            : step === 'hardware'
              ? 'Connect Hardware Wallet'
              : 'Add Wallet'}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        {step === 'wallet' && (
          <>
            <WalletOptionButton
              label="Import Wallet"
              icon={WALLET_OPTION_ICONS.import}
              onClick={() => setStep('import')}
            />
            <WalletOptionButton
              label="Create New Wallet"
              icon={WALLET_OPTION_ICONS.create}
              onClick={() => onSelect('create')}
            />
            <WalletOptionButton
              label="Connect Hardware Wallet"
              icon={WALLET_OPTION_ICONS.hardware}
              onClick={() => setStep('hardware')}
            />
          </>
        )}
        {step === 'import' && (
          <>
            <WalletOptionButton
              label="Secret Recovery Phrase"
              icon={WALLET_OPTION_ICONS.phrase}
              onClick={() => onSelect('import')}
            />
            <WalletOptionButton
              label="Private Key"
              icon={WALLET_OPTION_ICONS.key}
              onClick={() => onSelect('private-key')}
            />
          </>
        )}
        {step === 'hardware' &&
          HARDWARE_CONNECT_OPTIONS.map(device => (
            <WalletOptionButton
              key={device.vendor}
              label={device.name}
              icon={<HardwareWalletLogo vendor={device.vendor} />}
              onClick={() => onSelect(device.vendor)}
            />
          ))}
      </div>
    </>
  )
}
