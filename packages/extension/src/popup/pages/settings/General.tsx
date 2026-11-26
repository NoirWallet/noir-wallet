import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { useSettingsStore, AUTO_LOCK_OPTIONS } from '@/store/settings-store'
import { useEffect, useState } from 'react'
import { useLocalePreference, useTranslation } from '@/popup/i18n'
import { parseLocalePreference } from '@/popup/i18n/locale'
import { settingsMessages } from '@/popup/i18n/settings-messages'

export function General() {
  const { autoLockMs, setAutoLockMs, loadSettings } = useSettingsStore()
  const { t, locale } = useTranslation(settingsMessages)
  const { preference, setPreference } = useLocalePreference()
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [languageSaveFailed, setLanguageSaveFailed] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const themes = ['light', 'dark', 'system'] as const
  const minutes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'long'
  })
  const hours = new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'long' })

  const changeLanguage = async (value: string) => {
    setLanguageSaveFailed(false)
    setSavingLanguage(true)
    try {
      await setPreference(parseLocalePreference(value))
    } catch {
      setLanguageSaveFailed(true)
    } finally {
      setSavingLanguage(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title={t('general')} showBack />

      <div className="page-content space-y-6">
        <div>
          <label className="block text-sm text-muted mb-3">{t('autoLock')}</label>
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
                <span className="text-sm">
                  {option.value >= 3_600_000
                    ? hours.format(option.value / 3_600_000)
                    : minutes.format(option.value / 60_000)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted mb-3">{t('theme')}</label>
          <div className="flex gap-2">
            {themes.map(theme => (
              <button
                key={theme}
                disabled
                className={`flex-1 px-4 py-3 rounded-xl border transition-colors ${
                  theme === 'dark'
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-white/10 bg-card text-muted'
                } opacity-50 cursor-not-allowed`}
              >
                <span className="text-sm">{t(theme)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="wallet-language" className="mb-3 block text-sm text-muted">
            {t('language')}
          </label>
          <div className="relative">
            <select
              id="wallet-language"
              value={preference}
              onChange={event => void changeLanguage(event.currentTarget.value)}
              disabled={savingLanguage}
              aria-describedby={languageSaveFailed ? 'wallet-language-error' : undefined}
              className="wallet-interactive w-full appearance-none rounded-xl border border-white/10 bg-card py-4 pl-4 pr-10 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              <option value="browser">{t('followBrowser')}</option>
              <option value="en" lang="en">
                English
              </option>
              <option value="ko" lang="ko">
                한국어
              </option>
              <option value="zh-TW" lang="zh-TW">
                繁體中文
              </option>
            </select>
            <Icon
              icon="lucide:chevron-down"
              aria-hidden="true"
              width={16}
              height={16}
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted"
            />
          </div>
          {languageSaveFailed && (
            <p id="wallet-language-error" role="alert" className="mt-2 text-xs text-danger">
              {t('languageSaveFailed')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
