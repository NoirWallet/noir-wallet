import { Icon } from '@iconify/react'

export const TELEGRAM_SUPPORT_URL = 'https://t.me/noirprivacy'

const SOCIAL_LINKS = [
  { label: 'GitHub', url: 'https://zknoir.com/github', icon: 'lucide:github' },
  { label: 'X', url: 'https://x.com/noir_wallet', icon: null },
  { label: 'Telegram', url: TELEGRAM_SUPPORT_URL, icon: 'lucide:send' }
] as const

export function SocialLinks() {
  const openLink = (url: string, label: string) => {
    chrome.tabs.create({ url }).catch(error => {
      console.error(`[SocialLinks] Failed to open ${label}:`, error)
    })
  }

  return (
    <div className="flex items-center gap-2">
      {SOCIAL_LINKS.map(link => (
        <button
          key={link.url}
          type="button"
          data-analytics-outbound={`social_${link.label.toLowerCase()}`}
          data-analytics-domain={new URL(link.url).hostname}
          aria-label={link.label}
          title={link.label}
          onClick={() => openLink(link.url, link.label)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-white"
        >
          {link.icon ? (
            <Icon icon={link.icon} width={18} height={18} />
          ) : (
            <span className="text-sm font-medium">X</span>
          )}
        </button>
      ))}
    </div>
  )
}
