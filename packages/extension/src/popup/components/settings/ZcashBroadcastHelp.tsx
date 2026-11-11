import { Icon } from '@iconify/react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

const HELP = {
  broadcast: {
    title: 'Zcash private broadcast',
    paragraphs: [
      'Uses ZeroIndexer to help protect your network privacy when sending Zcash transactions involving Orchard (Shield). Broadcasting may take longer.',
      'If it fails, Noir falls back to regular Zcash RPC. Turning this off uses RPC directly.'
    ]
  },
  nodes: {
    title: 'What is a ZeroIndexer node?',
    paragraphs: [
      'ZeroIndexer relays Zcash transactions for added network privacy. It does not sync your wallet or read balances.',
      'Auto tries the managed nodes in order, or you can choose one yourself. Only add custom nodes you trust.'
    ]
  }
} as const

export function ZcashBroadcastHelp({ kind }: { kind: keyof typeof HELP }) {
  const content = HELP[kind]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            kind === 'broadcast' ? 'About Zcash private broadcast' : 'About ZeroIndexer nodes'
          }
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon icon="lucide:circle-help" className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        collisionPadding={16}
        className="max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto space-y-3 text-xs leading-5"
      >
        <p className="text-sm font-medium">{content.title}</p>
        {content.paragraphs.map(paragraph => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </PopoverContent>
    </Popover>
  )
}
