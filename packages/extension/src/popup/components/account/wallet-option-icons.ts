import type { IconifyIcon } from '@iconify/react'

const svg = (paths: string): IconifyIcon => ({
  width: 24,
  height: 24,
  body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
})

export const WALLET_OPTION_ICONS = {
  import: svg('<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>'),
  create: svg('<path d="M12 5v14M5 12h14"/>'),
  hardware: svg('<path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/>'),
  phrase: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  key: svg('<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-7-1 3-3"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>')
} as const
