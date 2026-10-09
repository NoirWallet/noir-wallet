import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import jsQR from 'jsqr'
import { URDecoder, type UR } from '@/lib/keystone'

const SCAN_INTERVAL_MS = 100
/** Downscale camera frames before jsQR to keep decoding fast */
const MAX_SCAN_DIMENSION = 640

interface QRScannerProps {
  /** Called once when a complete (possibly multi-frame) UR has been assembled */
  onScan: (ur: UR) => void
  className?: string
}

type CameraState = 'starting' | 'active' | 'denied' | 'error'

/**
 * Embedded camera scanner that accumulates BC-UR fountain frames.
 * Designed for full-tab pages (camera permission prompts don't survive
 * in popup windows).
 */
export function QRScanner({ onScan, className }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const decoderRef = useRef(new URDecoder())
  const completedRef = useRef(false)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const [cameraState, setCameraState] = useState<CameraState>('starting')
  const [progress, setProgress] = useState(0)
  const [frameError, setFrameError] = useState<string | null>(null)

  const processFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || completedRef.current) {
      return
    }

    const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(video.videoWidth, video.videoHeight))
    const width = Math.floor(video.videoWidth * scale)
    const height = Math.floor(video.videoHeight * scale)
    if (!width || !height) return

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }
    const canvas = canvasRef.current
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.drawImage(video, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const code = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' })
    if (!code?.data) return

    const text = code.data.trim()
    if (!text.toLowerCase().startsWith('ur:')) {
      setFrameError('Not a Keystone QR code')
      return
    }

    const decoder = decoderRef.current
    try {
      decoder.receivePart(text.toLowerCase())
      setFrameError(null)
    } catch {
      // Mixed content from a different UR sequence — restart accumulation
      decoderRef.current = new URDecoder()
      return
    }

    setProgress(Math.round(decoder.estimatedPercentComplete() * 100))

    if (decoder.isComplete()) {
      if (decoder.isSuccess()) {
        completedRef.current = true
        onScanRef.current(decoder.resultUR())
      } else {
        setFrameError(decoder.resultError() || 'Failed to decode QR sequence')
        decoderRef.current = new URDecoder()
        setProgress(0)
      }
    }
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setCameraState('active')
        timer = setInterval(processFrame, SCAN_INTERVAL_MS)
      } catch (e) {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        setCameraState(name === 'NotAllowedError' ? 'denied' : 'error')
      }
    }

    start()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [processFrame])

  if (cameraState === 'denied' || cameraState === 'error') {
    return (
      <div className={className}>
        <div className="flex flex-col items-center justify-center py-10 px-4 bg-card rounded-xl">
          <Icon icon="lucide:camera-off" width={32} height={32} className="text-danger mb-3" />
          <p className="text-sm font-medium mb-1">
            {cameraState === 'denied' ? 'Camera access denied' : 'Camera unavailable'}
          </p>
          <p className="text-xs text-muted text-center">
            {cameraState === 'denied'
              ? 'Allow camera access for this extension in your browser settings, then reload this page.'
              : 'Could not start the camera. Make sure another app is not using it.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon
              icon="lucide:loader-2"
              width={32}
              height={32}
              className="animate-spin text-primary"
            />
          </div>
        )}
        <div className="absolute inset-6 border-2 border-primary/60 rounded-xl pointer-events-none" />
      </div>

      {progress > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-card rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted text-center mt-1.5">Scanning… {progress}%</p>
        </div>
      )}

      {frameError && <p className="text-xs text-danger text-center mt-2">{frameError}</p>}
    </div>
  )
}
