import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import type { CreateSessionState } from '@/core/multisig/create-session'
import type { QrStep } from '@/core/multisig/qr-plan'
import type { DeviceSlot, MultisigDevice } from '@/core/multisig/types'
import { DeviceCard } from '@/popup/components/multisig/DeviceCard'
import { QrScanButton, QrScanPanel } from '@/popup/components/multisig/QrScanPanel'
import { QrShowPanel } from '@/popup/components/multisig/QrShowPanel'
import { FlowButton } from '@/popup/components/multisig/FlowButton'
import { createFlowRoute, qrStepRoute } from '@/popup/multisig/create-flow-routes'
import {
  currentQrStep,
  useCreateSessionStore,
  type PendingQrDisplay
} from '@/popup/multisig/create-session-store'
import { useNavigate } from '@/popup/provider/Router'
import { MultisigTabLayout } from './MultisigTabLayout'

type StepCounter = { current: number; total: number }

interface ShowStepCopy {
  description: string
  scanLabel: string
}

// Keyed by the plan's step titles (qr-plan.ts).
const SHOW_STEP_COPY: Readonly<Record<string, ShowStepCopy>> = {
  Shares: {
    description: 'This is the full group setup, plus the part only your phone can read.',
    scanLabel: 'Scan your computer again'
  },
  'Group setup': {
    description: 'Both phones scan this code.',
    scanLabel: 'Scan your computer'
  },
  'Encrypted shares': {
    description: 'Only this phone can read it.',
    scanLabel: 'Scan your computer'
  }
}
const FALLBACK_SHOW_COPY: ShowStepCopy = { description: '', scanLabel: 'Scan your computer' }

function guardianDevice(session: CreateSessionState, slot: DeviceSlot): MultisigDevice | null {
  return session.devices.find(entry => entry.slot === slot)?.device ?? null
}

function deviceTitle(device: MultisigDevice | null, slot: DeviceSlot): string {
  return device ? `${device.name} · ${device.model}` : `Device ${slot}`
}

/** "Step n of m" above the ring; the ceremony has no device line of its own. */
function StepLabel({ counter }: { counter: StepCounter }) {
  return (
    <p className="text-xs text-muted">
      Step {counter.current} of {counter.total}
    </p>
  )
}

/** Holds the page while the next code is prepared or the session moves to another page. */
function QrStepLoading() {
  return (
    <MultisigTabLayout step={3} title="Multisig" showBack={false}>
      <div
        role="status"
        aria-label="Loading"
        className="flex min-h-full items-center justify-center"
      >
        <Icon
          icon="lucide:loader-2"
          width={32}
          height={32}
          className="animate-spin text-primary motion-reduce:animate-none"
        />
      </div>
    </MultisigTabLayout>
  )
}

function ScannedMark() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
      <Icon icon="lucide:check" width={14} height={14} aria-hidden="true" />
      Scanned
    </span>
  )
}

interface QrStepViewProps {
  session: CreateSessionState
  step: QrStep
  counter: StepCounter
}

/** A code on screen for one or both phones; each phone is marked once it has scanned it. */
function QrShowStep({
  session,
  step,
  counter,
  display
}: QrStepViewProps & { display: PendingQrDisplay | null }) {
  const markPhoneScanned = useCreateSessionStore(state => state.markPhoneScanned)
  const refreshDisplay = useCreateSessionStore(state => state.refreshDisplay)

  // The driver sets the code in the same dispatch that opens the step, so this is momentary.
  if (!display) return <QrStepLoading />

  const copy = SHOW_STEP_COPY[step.title] ?? FALLBACK_SHOW_COPY
  const pending = step.slots.filter(slot => !session.qrShownTo.includes(slot))
  // Every phone that still has to scan gets its own button; the reducer moves to the next step
  // once the last one is marked.
  const buttonLabel = (slot: DeviceSlot) =>
    step.slots.length === 1
      ? 'Phone scanned, continue'
      : `${guardianDevice(session, slot)?.model ?? `Device ${slot}`} scanned`

  return (
    <MultisigTabLayout
      step={3}
      title="Multisig"
      showBack={false}
      footer={
        pending.length > 0 ? (
          <div className="space-y-3">
            {/* One filled primary per screen: the next phone to scan gets it, the rest outline. */}
            {pending.map((slot, index) => (
              <FlowButton
                key={slot}
                variant={index === 0 ? 'default' : 'outline'}
                onClick={() => markPhoneScanned(slot)}
              >
                {buttonLabel(slot)}
              </FlowButton>
            ))}
          </div>
        ) : undefined
      }
    >
      <QrShowPanel
        counter={counter}
        ringLabel={<StepLabel counter={counter} />}
        title={step.title}
        description={copy.description}
        scanLabel={copy.scanLabel}
        envelope={display.envelope}
        expiresAt={display.expiresAt}
        onRefresh={refreshDisplay}
      >
        <div className="mt-5 w-full space-y-3 text-left">
          {step.slots.map(slot => (
            <DeviceCard
              key={slot}
              slot={slot}
              role="guardian"
              title={deviceTitle(guardianDevice(session, slot), slot)}
              // The card's own status labels are about connections; here only the scan matters,
              // and an empty fragment (not null, which falls back to the label) shows nothing.
              status="connected"
              trailing={session.qrShownTo.includes(slot) ? <ScannedMark /> : <></>}
            />
          ))}
        </div>
      </QrShowPanel>
    </MultisigTabLayout>
  )
}

/** Reads one phone's reply code. The reducer moves on as soon as it accepts the reply. */
function QrScanStep({ session, step, counter }: QrStepViewProps) {
  const ingestScan = useCreateSessionStore(state => state.ingestScan)
  const [scanning, setScanning] = useState(false)
  const slot = step.slots[0]

  return (
    <MultisigTabLayout
      step={3}
      title="Multisig"
      showBack={false}
      footer={scanning ? undefined : <QrScanButton onClick={() => setScanning(true)} />}
    >
      <QrScanPanel
        counter={counter}
        ringLabel={<StepLabel counter={counter} />}
        title={step.title}
        description={`Scan ${deviceTitle(guardianDevice(session, slot), slot)}`}
        scanning={scanning}
        onScan={ingestScan}
      />
    </MultisigTabLayout>
  )
}

/**
 * Step 3 over QR: `/multisig/create/qr/:index`, one code to show or scan per step. There is no
 * back arrow: the roster is locked, and leaving means aborting the session.
 */
export function QrStepPage() {
  const { index } = useParams()
  const { replace } = useNavigate()
  const session = useCreateSessionStore(state => state.session)
  const pendingDisplay = useCreateSessionStore(state => state.pendingDisplay)
  const pendingScan = useCreateSessionStore(state => state.pendingScan)
  // currentQrStep builds a new object on every call, so it is computed here from the three
  // fields instead of being handed to the store as a selector.
  const current = useMemo(
    () => currentQrStep({ session, pendingDisplay, pendingScan }),
    [session, pendingDisplay, pendingScan]
  )

  // The session decides the step: a finished step moves the URL to the next index, the round-1
  // check and the final check go to the verify page, and a Bluetooth session to its ceremony.
  const target = session ? createFlowRoute(session) : null
  const here = qrStepRoute(index ?? '')
  useEffect(() => {
    if (target !== null && target !== here) replace(target)
  }, [target, here, replace])

  // The route guard already redirects when the session is missing or aborted.
  if (!session) return null

  // Rendered from the session even before the URL has caught up, so the next step's content
  // replaces the finished one directly.
  const onQrStep = target !== null && target === qrStepRoute(session.qrCeremonyIndex)
  if (!onQrStep || !current || current.step.kind === 'verify') return <QrStepLoading />

  // Keyed by the step, so each code or scan starts with fresh page state (and the camera closed).
  return current.step.kind === 'show' ? (
    <QrShowStep
      key={session.qrCeremonyIndex}
      session={session}
      step={current.step}
      counter={current.counter}
      display={pendingDisplay}
    />
  ) : (
    <QrScanStep
      key={session.qrCeremonyIndex}
      session={session}
      step={current.step}
      counter={current.counter}
    />
  )
}
