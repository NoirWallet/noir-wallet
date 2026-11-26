import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  LOCALE_STORAGE_KEY,
  parseLocalePreference,
  readLocalePreference,
  writeLocalePreference,
  type LocalePreference,
  type WalletLocale
} from './locale'
import { createTranslator, type MessageCatalog } from './messages'

export { createTranslator, type MessageCatalog } from './messages'
export type { LocalePreference, WalletLocale } from './locale'

const LocaleContext = createContext<WalletLocale>('en')
const PreferenceContext = createContext<LocalePreference>('browser')

export function LocaleProvider({
  initialPreference,
  browserLocale,
  children
}: {
  initialPreference: LocalePreference
  browserLocale: WalletLocale
  children: ReactNode
}) {
  const [preference, setPreference] = useState(initialPreference)

  useEffect(() => {
    let active = true
    let storageChanged = false
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      const change = changes[LOCALE_STORAGE_KEY]
      if (area === 'local' && change) {
        storageChanged = true
        setPreference(parseLocalePreference(change.newValue))
      }
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    void readLocalePreference()
      .then(stored => {
        if (active && !storageChanged) setPreference(stored)
      })
      .catch(() => {})

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  return (
    <PreferenceContext.Provider value={preference}>
      <LocaleContext.Provider value={preference === 'browser' ? browserLocale : preference}>
        {children}
      </LocaleContext.Provider>
    </PreferenceContext.Provider>
  )
}

export function EnglishCopy({
  active = true,
  children
}: {
  active?: boolean
  children: ReactNode
}) {
  const locale = useLocale()
  return <LocaleContext.Provider value={active ? 'en' : locale}>{children}</LocaleContext.Provider>
}

export function useLocale(): WalletLocale {
  return useContext(LocaleContext)
}

export function useLocalePreference() {
  return { preference: useContext(PreferenceContext), setPreference: writeLocalePreference }
}

export function useTranslation<Catalog extends MessageCatalog>(messages: Catalog) {
  const locale = useLocale()
  const t = useMemo(() => createTranslator(messages, locale), [messages, locale])
  return { locale, t }
}
