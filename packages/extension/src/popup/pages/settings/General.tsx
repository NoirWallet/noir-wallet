import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/store/settings-store'
import { useEffect } from 'react'

export function General() {
  const { autoLockMs, setAutoLockMs, loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const themes = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' }
  ]

  const languages = [{ code: 'en', label: 'English' }]

  const currentTheme = 'dark'
  const currentLanguage = 'en'

  return (
    <div className="page-container">
      <PageHeader title="General" showBack />

      <div className="page-content space-y-6">
        <div>
          <label className="block text-sm text-muted mb-3">Auto-lock Timer</label>
          <div className="grid grid-cols-3 gap-2">
            {AUTO_LOCK_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => setAutoLockMs(option.value)}
                className={`px-3 py-3 rounded-xl border transition-colors ${
                  autoLockMs === option.value
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-white/10 bg-card text-muted hover:bg-white/5'
                }`}
              >
                <span className="text-sm">{option.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">
            Wallet will automatically lock after this period of inactivity
          </p>
        </div>

        <div>
          <label className="block text-sm text-muted mb-3">Theme (Coming soon)</label>
          <div className="flex gap-2">
            {themes.map(theme => (
              <button
                key={theme.id}
                disabled
                className={`flex-1 px-4 py-3 rounded-xl border transition-colors ${
                  currentTheme === theme.id
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-white/10 bg-card text-muted'
                } opacity-50 cursor-not-allowed`}
              >
                <span className="text-sm">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted mb-3">Language (Coming soon)</label>
          <button
            disabled
            className="w-full p-4 bg-card rounded-xl border border-white/10 opacity-50 cursor-not-allowed"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {languages.find(l => l.code === currentLanguage)?.label || 'English'}
              </span>
              <Icon icon="lucide:chevron-down" width={16} height={16} className="text-muted" />
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
