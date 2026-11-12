import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import type { UR } from '@ngraveio/bc-ur'
import { QRScanner } from '@/popup/components/hardware/QRScanner'
import { FlowButton } from './FlowButton'
import { toast } from '@/store/toast-store'
import { QrPanelHeading, type QrPanelHeadingProps } from './QrPanelHeading'

// How long a rejected code is left alone before the scanner starts again.
const RESCAN_DELAY_MS = 1500

interface QrScanPanelProps extends QrPanelHeadingProps {
  /** Shown until the camera opens. */
  description: string
  /** Whether the camera is open; the page's footer button opens it. */
  scanning: boolean
  /** The reply was accepted and the page is about to move on. */
  accepted?: boolean
  /** Hands a complete code to the session; 'ignored' when it was not the awaited reply. */
  onScan: (ur: UR) => 'accepted' | 'ignored'
}

/** The footer action that opens the camera for a scan panel. */
export function QrScanButton({ onClick }: { onClick: () => void }) {
  return (
    <FlowButton onClick={onClick}>
      <Icon icon="lucide:scan" aria-hidden="true" />
      Scan your phone
    </FlowButton>
  )
}

/** Reads a phone's reply code with the camera and restarts the scanner after a wrong code. */
export function QrScanPanel({
  description,
  scanning,
  accepted = false,
  onScan,
  ...heading
}: QrScanPanelProps) {
  const [scanAttempt, setScanAttempt] = useState(0)
  const [rejected, setRejected] = useState(false)

  // The scanner stops after its first complete code and cannot be re-armed from outside, so a
  // rejected code gets a fresh scanner. The pause keeps a wrong code that stays in front of the
  // camera from toasting and restarting the camera in a tight loop.
  useEffect(() => {
    if (!rejected) return
    const timer = window.setTimeout(() => {
      setScanAttempt(attempt => attempt + 1)
      setRejected(false)
    }, RESCAN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [rejected])

  const handleScan = (ur: UR) => {
    if (onScan(ur) === 'accepted') return
    toast.error('Unrecognized code')
    setRejected(true)
  }

  return (
    <div className="flex flex-col items-center text-center">
      <QrPanelHeading {...heading} />
      {scanning ? (
        <>
          <p className="mt-2 text-xs text-muted">
            Hold your phone&apos;s QR code up to the camera.
          </p>
          <QRScanner key={scanAttempt} onScan={handleScan} className="mt-4 w-full max-w-[320px]" />
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{description}</p>
      )}
      {accepted && (
        <p role="status" className="mt-3 text-xs text-muted">
          Checking device and setup…
        </p>
      )}
    </div>
  )
}
