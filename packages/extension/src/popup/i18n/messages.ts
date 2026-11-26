import { WALLET_LOCALES, type WalletLocale } from './locale'

export type MessageCatalog = Readonly<Record<string, readonly [string, string, string]>>
type MessageValues = Readonly<Record<string, string | number>>

export function createTranslator<Catalog extends MessageCatalog>(
  messages: Catalog,
  locale: WalletLocale
) {
  const index = WALLET_LOCALES.indexOf(locale)
  return (key: Extract<keyof Catalog, string>, values?: MessageValues): string => {
    const translations = messages[key]
    const text = translations[index] || translations[0]
    if (!values) return text
    return text.replace(/\{([\w]+)\}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
    )
  }
}
