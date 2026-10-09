import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { findChainEndpointOverride, withChainExplorer } from '@/core/chains/chain-endpoint-settings'
import { useSettingsStore } from '@/store/settings-store'
import { toast } from '@/store/toast-store'
import { ChainIcon } from '../../components/common/ChainIcon'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { chainEndpointSettingsClient } from '../../services/chain-endpoint-settings-client'
import {
  buildExplorerChainOptions,
  type ExplorerChainOption
} from '@/popup/services/chain-settings-options'

export function PreferredExplorer() {
  const settings = useSettingsStore(state => state.chainEndpointSettings)
  const setSettings = useSettingsStore(state => state.setChainEndpointSettings)
  const [editing, setEditing] = useState<ExplorerChainOption | null>(null)
  const [url, setUrl] = useState('')
  const [transactionPath, setTransactionPath] = useState('tx')
  const [saving, setSaving] = useState(false)
  const options = useMemo(() => buildExplorerChainOptions(settings), [settings])

  const openEditor = (option: ExplorerChainOption) => {
    const override = findChainEndpointOverride(settings, option.chainId)?.explorer
    setUrl(override?.baseUrl ?? option.defaultUrl)
    setTransactionPath(override?.transactionPath ?? option.defaultTransactionPath)
    setEditing(option)
  }

  const apply = async (custom: boolean) => {
    if (!editing || saving) return
    setSaving(true)
    try {
      const next = withChainExplorer(
        settings,
        editing.chainId,
        custom
          ? {
              label: `Custom ${editing.label} Explorer`,
              baseUrl: url.trim(),
              transactionPath: transactionPath.trim()
            }
          : undefined
      )
      const saved = await chainEndpointSettingsClient.apply(next)
      setSettings(saved)
      toast.success(
        custom ? 'Custom Explorer Saved' : 'Default Explorer Restored',
        `${editing.label} transaction links were updated.`
      )
      setEditing(null)
    } catch (error) {
      toast.error(
        'Explorer Update Failed',
        error instanceof Error ? error.message : 'Check the explorer URL and path.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Block Explorers" showBack />
      <div className="page-content space-y-3 pb-5">
        <p className="text-xs leading-5 text-muted">
          Explorer settings only change outbound transaction links. They are not used for signing or
          broadcasting.
        </p>
        {options.map(option => {
          const custom = findChainEndpointOverride(settings, option.chainId)?.explorer
          return (
            <button
              key={option.chainId}
              type="button"
              onClick={() => openEditor(option)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left transition-colors hover:border-primary/30"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white">
                <ChainIcon
                  chain={option.iconChain}
                  className="size-8 rounded-full"
                  showTooltip={false}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{option.label}</span>
                  {custom && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      Custom
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted">
                  {custom?.baseUrl || option.defaultUrl
                    ? (custom?.baseUrl ?? option.defaultUrl).replace(/^https?:\/\//, '')
                    : 'Not configured'}
                </p>
              </div>
              <Icon icon="lucide:chevron-right" className="size-4 shrink-0 text-muted" />
            </button>
          )
        })}
      </div>

      <Dialog open={editing !== null} onOpenChange={open => !open && !saving && setEditing(null)}>
        <DialogContent position="bottom">
          <DialogHeader>
            <DialogTitle>{editing?.label} Explorer</DialogTitle>
            <DialogDescription>
              Transaction links use Base URL / Transaction path / Hash.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label={`${editing?.label ?? ''} explorer URL`}
            type="url"
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder="https://explorer.example"
            className="h-11 rounded-xl font-mono text-xs"
          />
          <Input
            aria-label="Transaction path"
            value={transactionPath}
            onChange={event => setTransactionPath(event.target.value)}
            placeholder="tx"
            className="h-11 rounded-xl font-mono text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={
                !editing ||
                !editing.defaultUrl ||
                !findChainEndpointOverride(settings, editing.chainId)?.explorer
              }
              onClick={() => void apply(false)}
            >
              Use Default
            </Button>
            <Button
              className="h-11"
              isLoading={saving}
              disabled={!url.trim() || !transactionPath.trim()}
              onClick={() => void apply(true)}
            >
              Save Explorer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
