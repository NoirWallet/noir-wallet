import { createTranslator, type WalletLocale } from '@/popup/i18n'
import { sendMessages } from './send-messages'

type SendMessageKey = keyof typeof sendMessages

const keyByEnglish = new Map<string, SendMessageKey>(
  (Object.keys(sendMessages) as SendMessageKey[]).map(key => [sendMessages[key][0], key])
)

export function createSendCopy(locale: WalletLocale) {
  const t = createTranslator(sendMessages, locale)
  return (text: string): string => {
    if (locale === 'en') return text
    const key = keyByEnglish.get(text)
    if (key) return t(key)

    const insufficient = /^Insufficient (.+) balance$/.exec(text)
    if (insufficient) return t('insufficient', { symbol: insufficient[1] })
    const unavailable = /^(.+) is unavailable\. Check your connection and try again\.$/.exec(text)
    if (unavailable) {
      if (unavailable[1] === 'The Bitcoin network')
        return t('networkUnavailable', { network: 'Bitcoin' })
      return t('networkUnavailable', { network: unavailable[1] })
    }
    const mismatch =
      /^The (Bitcoin|Solana|NEAR) review does not match the requested transfer\.$/.exec(text)
    if (mismatch) return t('reviewMismatch', { network: mismatch[1] })
    const invalid = /^The wallet returned an invalid (Bitcoin|EVM) review\.$/.exec(text)
    if (invalid) return t('invalidReview', { network: invalid[1] })

    const confirmations = /^Confirming \((\d+)\/(\d+)\)$/.exec(text)
    if (confirmations) {
      return t('confirmingCount', { confirmed: confirmations[1], required: confirmations[2] })
    }

    const blockEstimate = /^~(\d+) blocks$/.exec(text)
    if (blockEstimate) return t('approximateBlocks', { count: blockEstimate[1] })
    const timeEstimate = /^([<~]?\d+(?:–\d+)?) (sec|min)(\+?)$/.exec(text)
    if (timeEstimate) {
      return (
        t(timeEstimate[2] === 'sec' ? 'seconds' : 'minutes', { value: timeEstimate[1] }) +
        timeEstimate[3]
      )
    }

    return text
  }
}
