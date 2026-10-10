import { Icon } from '@iconify/react'
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import {
  DEFAULT_GOOGLE_ANALYTICS_ENABLED,
  isGoogleAnalyticsEnabled,
  setGoogleAnalyticsEnabled
} from '@/lib/analytics/preferences'
import { Switch } from '@/popup/components/ui/switch'
import { toast } from '@/store/toast-store'
import { parseZeroIndexerEnabled } from '@/config/zero-indexer-settings'
import { SETTINGS_STORAGE_KEY } from '@/config/storage-keys'

export function SecurityPrivacy() {
  const { navigate } = useNavigate()
  const [analyticsEnabled, setAnalyticsEnabled] = useState(DEFAULT_GOOGLE_ANALYTICS_ENABLED)
  const [zeroIndexerEnabled, setZeroIndexerEnabled] = useState(true)
  const [zeroIndexerLoaded, setZeroIndexerLoaded] = useState(false)
  const [zeroIndexerSaving, setZeroIndexerSaving] = useState(false)
  const zeroIndexerRevision = useRef(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    void isGoogleAnalyticsEnabled().then(enabled => {
      if (active) {
        setAnalyticsEnabled(enabled)
        setIsLoaded(true)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SETTINGS_STORAGE_KEY] && active) {
        zeroIndexerRevision.current += 1
        setZeroIndexerEnabled(parseZeroIndexerEnabled(changes[SETTINGS_STORAGE_KEY].newValue))
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    const initialRevision = zeroIndexerRevision.current
    chrome.runtime
      .sendMessage({ type: 'GET_ZERO_INDEXER_ENABLED' })
      .then(response => {
        if (!active) return
        if (response?.success && typeof response.enabled === 'boolean') {
          if (zeroIndexerRevision.current === initialRevision)
            setZeroIndexerEnabled(response.enabled)
          setZeroIndexerLoaded(true)
        } else {
          toast.error('Could not load privacy broadcast preference')
        }
      })
      .catch(() => {
        if (active) toast.error('Could not load privacy broadcast preference')
      })
    return () => {
      active = false
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  const handleZeroIndexerToggle = async () => {
    if (!zeroIndexerLoaded || zeroIndexerSaving) return
    const enabled = !zeroIndexerEnabled
    const currentRevision = zeroIndexerRevision.current
    setZeroIndexerSaving(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_ZERO_INDEXER_ENABLED',
        enabled
      })
      if (!response?.success)
        throw new Error(response?.error || 'Could not update privacy broadcast preference')
      if (zeroIndexerRevision.current === currentRevision) setZeroIndexerEnabled(response.enabled)
      if (response.warning) toast.error(response.warning)
    } catch {
      toast.error('Could not update privacy broadcast preference')
    } finally {
      setZeroIndexerSaving(false)
    }
  }

  const handleAnalyticsToggle = async () => {
    if (!isLoaded || isSaving) return
    const nextEnabled = !analyticsEnabled
    setAnalyticsEnabled(nextEnabled)
    setIsSaving(true)
    try {
      await setGoogleAnalyticsEnabled(nextEnabled)
    } catch {
      setAnalyticsEnabled(!nextEnabled)
      toast.error('Could not update analytics preference')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Security & Privacy" showBack />

      <div className="page-content space-y-5">
        <div>
          <p className="text-xs text-muted mb-2 px-1">Security</p>
          <button
            onClick={() => navigate('/change-password')}
            className="w-full p-4 bg-card rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm">Change Password</span>
              <Icon icon="lucide:chevron-right" width={16} height={16} className="text-muted" />
            </div>
          </button>
        </div>

        <div>
          <p className="text-xs text-muted mb-2 px-1">Privacy</p>
          <div>
            <button
              type="button"
              role="switch"
              aria-checked={zeroIndexerEnabled}
              aria-label="ZeroIndexer"
              disabled={!zeroIndexerLoaded || zeroIndexerSaving}
              onClick={handleZeroIndexerToggle}
              className="w-full p-4 mb-3 bg-card rounded-xl border border-white/10 hover:bg-white/5 cursor-pointer transition-colors disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-4 text-left">
                <div>
                  <div className="text-sm">ZeroIndexer</div>
                  <div className="text-xs text-muted mt-1 leading-relaxed">
                    Prefer the privacy broadcast service for transactions.
                  </div>
                </div>
                <div className="pt-0.5">
                  <Switch checked={zeroIndexerEnabled} />
                </div>
              </div>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={analyticsEnabled}
              aria-label="Share Google Analytics"
              disabled={!isLoaded || isSaving}
              onClick={handleAnalyticsToggle}
              className="w-full p-4 bg-card rounded-xl border border-white/10 hover:bg-white/5 cursor-pointer transition-colors disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-4 text-left">
                <div>
                  <div className="text-sm">Share Google Analytics</div>
                  <div className="text-xs text-muted mt-1 leading-relaxed">
                    Share anonymous feature usage with Google Analytics. Noir Wallet service metrics
                    remain active and may include transaction amounts and estimated USD values for
                    aggregate volume reporting. They never include wallet addresses, transaction
                    hashes, dApp domains, recovery phrases, passwords, or private keys.
                  </div>
                </div>
                <div className="pt-0.5">
                  <Switch checked={analyticsEnabled} />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
