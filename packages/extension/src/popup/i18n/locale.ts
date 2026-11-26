export const WALLET_LOCALES = ['en', 'ko', 'zh-TW'] as const
export type WalletLocale = (typeof WALLET_LOCALES)[number]
export type LocalePreference = WalletLocale | 'browser'

export const LOCALE_STORAGE_KEY = 'wallet_ui_locale'

export function parseLocalePreference(value: unknown): LocalePreference {
  return value === 'en' || value === 'ko' || value === 'zh-TW' ? value : 'browser'
}

export function resolveBrowserLocale(language: string): WalletLocale {
  try {
    const locale = new Intl.Locale(language.replace(/_/g, '-'))
    if (locale.language === 'ko') return 'ko'
    if (locale.language === 'zh') {
      const traditionalRegion =
        locale.region === 'TW' || locale.region === 'HK' || locale.region === 'MO'
      if (locale.script === 'Hant' || (!locale.script && traditionalRegion)) return 'zh-TW'
    }
  } catch {
    return 'en'
  }
  return 'en'
}

export function getBrowserWalletLocale(): WalletLocale {
  return resolveBrowserLocale(globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language)
}

export async function readLocalePreference(): Promise<LocalePreference> {
  const values = await chrome.storage.local.get(LOCALE_STORAGE_KEY)
  return parseLocalePreference(values[LOCALE_STORAGE_KEY])
}

export async function writeLocalePreference(preference: LocalePreference): Promise<void> {
  if (preference === 'browser') await chrome.storage.local.remove(LOCALE_STORAGE_KEY)
  else await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: preference })
}
