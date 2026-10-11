import { Icon } from '@iconify/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseZeroIndexerNodeStatus,
  ZERO_INDEXER_NODES_STORAGE_KEY,
  ZERO_INDEXER_RUNTIME_STORAGE_KEY,
  type ZeroIndexerEndpoint,
  type ZeroIndexerNodeStatus
} from '@/config/zero-indexer-nodes'
import { SETTINGS_STORAGE_KEY } from '@/config/storage-keys'
import { cn } from '@/lib/utils'
import { ChainIcon } from '../../components/common/ChainIcon'
import {
  EndpointLatencyBadge as PingBadge,
  EndpointSelectionIndicator as SelectionIndicator
} from '../../components/common/EndpointStatus'
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

type NodeMessage =
  | { type: 'SELECT_ZERO_INDEXER_NODE'; endpointId: string | null }
  | { type: 'ADD_CUSTOM_ZERO_INDEXER_NODE'; label: string; url: string }
  | { type: 'REMOVE_CUSTOM_ZERO_INDEXER_NODE'; endpointId: string }

function readStatus(response: unknown): { status: ZeroIndexerNodeStatus; warning?: string } {
  if (!response || typeof response !== 'object') throw new Error('Could not load broadcast nodes')
  const result = response as {
    success?: unknown
    result?: unknown
    error?: unknown
    warning?: unknown
  }
  if (result.success !== true) {
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Could not load broadcast nodes'
    )
  }
  return {
    status: parseZeroIndexerNodeStatus(result.result),
    warning: typeof result.warning === 'string' ? result.warning : undefined
  }
}

export function ZeroIndexerNodes() {
  const [status, setStatus] = useState<ZeroIndexerNodeStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [applyingKey, setApplyingKey] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ZeroIndexerEndpoint | null>(null)
  const revision = useRef(0)
  const mounted = useRef(false)

  const loadStatus = useCallback(
    async (type: 'GET_ZERO_INDEXER_NODES' | 'REFRESH_ZERO_INDEXER_NODES') => {
      const currentRevision = ++revision.current
      if (type === 'REFRESH_ZERO_INDEXER_NODES') setRefreshing(true)
      try {
        const response = await chrome.runtime.sendMessage({ type })
        const { status: nextStatus } = readStatus(response)
        if (mounted.current && currentRevision === revision.current) {
          setStatus(nextStatus)
          setLoadError(null)
        }
      } catch (error) {
        if (mounted.current && currentRevision === revision.current) {
          setLoadError(error instanceof Error ? error.message : 'Could not load broadcast nodes')
        }
      } finally {
        if (mounted.current && currentRevision === revision.current) setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    mounted.current = true
    let active = true
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (
        (area === 'local' &&
          (changes[ZERO_INDEXER_NODES_STORAGE_KEY] ||
            changes[SETTINGS_STORAGE_KEY] ||
            changes[ZERO_INDEXER_RUNTIME_STORAGE_KEY])) ||
        (area === 'session' && changes[ZERO_INDEXER_RUNTIME_STORAGE_KEY])
      ) {
        void loadStatus('GET_ZERO_INDEXER_NODES')
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    void loadStatus('GET_ZERO_INDEXER_NODES').then(() => {
      if (active) void loadStatus('REFRESH_ZERO_INDEXER_NODES')
    })
    return () => {
      active = false
      mounted.current = false
      revision.current += 1
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [loadStatus])

  const runMutation = async (
    key: string,
    message: NodeMessage
  ): Promise<{ saved: boolean; error?: string }> => {
    if (applyingKey) return { saved: false }
    ++revision.current
    setApplyingKey(key)
    setActionError(null)
    try {
      const { status: nextStatus, warning } = readStatus(await chrome.runtime.sendMessage(message))
      if (mounted.current) {
        ++revision.current
        setStatus(nextStatus)
        setLoadError(null)
        if (warning) setActionError(warning)
      }
      return { saved: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update broadcast node'
      if (mounted.current && key !== 'add') setActionError(message)
      return { saved: false, error: message }
    } finally {
      if (mounted.current) {
        setApplyingKey(null)
        setRefreshing(false)
      }
    }
  }

  const handleAdd = async () => {
    const url = customUrl.trim()
    if (!url) {
      setUrlError('Enter a URL')
      return
    }
    try {
      if (new URL(url).protocol !== 'https:') throw new Error('Enter an HTTPS URL')
    } catch {
      setUrlError('Enter a valid HTTPS URL')
      return
    }
    setNameError(null)
    setUrlError(null)
    setAddError(null)
    const result = await runMutation('add', {
      type: 'ADD_CUSTOM_ZERO_INDEXER_NODE',
      label: customName.trim(),
      url
    })
    if (result.saved) {
      setAddOpen(false)
      setCustomName('')
      setCustomUrl('')
    } else {
      if (result.error) {
        if (/name/i.test(result.error)) setNameError(result.error)
        else if (/url|https|endpoint|node/i.test(result.error)) setUrlError(result.error)
        else setAddError(result.error)
      }
    }
  }

  const handleRemove = async () => {
    if (!deleteTarget) return
    const result = await runMutation('remove', {
      type: 'REMOVE_CUSTOM_ZERO_INDEXER_NODE',
      endpointId: deleteTarget.id
    })
    if (result.saved) setDeleteTarget(null)
  }

  const endpoints = status ? [...status.managedEndpoints, ...status.customEndpoints] : []
  const preferred = endpoints.find(endpoint => endpoint.id === status?.orderedEndpointIds[0])

  const renderNode = (endpoint: ZeroIndexerEndpoint, index: number, custom = false) => {
    const selected = status?.mode === 'fixed' && status.selectedEndpointId === endpoint.id
    const probe = status?.probes[endpoint.id]
    return (
      <div
        key={endpoint.id}
        className={cn('flex min-h-11 items-center gap-1', index > 0 && 'border-t border-white/10')}
      >
        <button
          type="button"
          aria-pressed={selected}
          disabled={!!applyingKey}
          onClick={() =>
            void runMutation(endpoint.id, {
              type: 'SELECT_ZERO_INDEXER_NODE',
              endpointId: endpoint.id
            })
          }
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm text-white">
              <span className="truncate">{endpoint.label}</span>
              {custom && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  Custom
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-muted">
              {endpoint.url.replace(/^https:\/\//, '')}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <PingBadge result={probe} />
            <SelectionIndicator selected={!!selected} applying={applyingKey === endpoint.id} />
          </span>
        </button>
        {custom && (
          <button
            type="button"
            title={`Remove ${endpoint.label}`}
            aria-label={`Remove ${endpoint.label}`}
            disabled={!!applyingKey}
            onClick={() => setDeleteTarget(endpoint)}
            className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
          >
            <Icon icon="lucide:trash-2" width={16} height={16} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader
        title="ZeroIndexer Nodes"
        showBack
        action={{
          icon: (
            <Icon
              icon="lucide:refresh-cw"
              width={14}
              height={14}
              className={cn(refreshing && 'animate-spin')}
            />
          ),
          onClick: () => {
            if (!refreshing) void loadStatus('REFRESH_ZERO_INDEXER_NODES')
          }
        }}
      />
      <div className="page-content space-y-6">
        {loadError && (
          <p role="alert" className="text-xs text-danger">
            {loadError}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-xs text-danger">
            {actionError}
          </p>
        )}
        {!status && loadError ? (
          <Button variant="outline" onClick={() => void loadStatus('GET_ZERO_INDEXER_NODES')}>
            Retry
          </Button>
        ) : !status ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Icon icon="lucide:loader-2" width={16} height={16} className="animate-spin" />
            Loading nodes
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center overflow-hidden rounded-full bg-white">
                  <ChainIcon chain="zec" className="size-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-medium text-white">
                    {status.network === 'testnet' ? 'Zcash Testnet' : 'Zcash'}
                  </h2>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl bg-card">
                <button
                  type="button"
                  aria-pressed={status.mode === 'auto'}
                  disabled={!!applyingKey}
                  onClick={() =>
                    void runMutation('auto', { type: 'SELECT_ZERO_INDEXER_NODE', endpointId: null })
                  }
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-white">
                      <span>Auto</span>
                      {status.mode === 'auto' && preferred && (
                        <span
                          title={`Preferred: ${preferred.label}`}
                          className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] leading-4 text-primary"
                        >
                          {preferred.label}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      Automatically switches when a node is unavailable
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {status.mode === 'auto' && (
                      <PingBadge result={preferred ? status.probes[preferred.id] : undefined} />
                    )}
                    <SelectionIndicator
                      selected={status.mode === 'auto'}
                      applying={applyingKey === 'auto'}
                    />
                  </span>
                </button>
                {status.managedEndpoints.map((endpoint, index) => renderNode(endpoint, index + 1))}
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-medium text-white">Custom Nodes</h2>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    setNameError(null)
                    setUrlError(null)
                    setAddError(null)
                    setAddOpen(true)
                  }}
                >
                  <Icon icon="lucide:plus" width={15} height={15} />
                  Add
                </Button>
              </div>
              {status.customEndpoints.length > 0 ? (
                <div className="overflow-hidden rounded-xl bg-card">
                  {status.customEndpoints.map((endpoint, index) =>
                    renderNode(endpoint, index, true)
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-card/45 px-4 py-3 text-xs text-muted">
                  No custom endpoints saved.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={open => !applyingKey && setAddOpen(open)}>
        <DialogContent position="bottom">
          <DialogHeader>
            <DialogTitle>Add Custom Node</DialogTitle>
            <DialogDescription className="sr-only">Save a custom broadcast node</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input
                aria-label="Node name"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'zero-indexer-name-error' : undefined}
                value={customName}
                onChange={event => {
                  setCustomName(event.target.value)
                  setNameError(null)
                }}
                placeholder="Name (optional)"
                className="h-11 rounded-xl"
              />
              {nameError && (
                <p
                  id="zero-indexer-name-error"
                  role="alert"
                  className="mt-1 px-1 text-xs text-danger"
                >
                  {nameError}
                </p>
              )}
            </div>
            <div>
              <Input
                aria-label="Node URL"
                aria-invalid={!!urlError}
                aria-describedby={urlError ? 'zero-indexer-url-error' : undefined}
                type="url"
                value={customUrl}
                onChange={event => {
                  setCustomUrl(event.target.value)
                  setUrlError(null)
                }}
                placeholder="https://example.com"
                className="h-11 rounded-xl font-mono text-xs"
              />
              {urlError && (
                <p
                  id="zero-indexer-url-error"
                  role="alert"
                  className="mt-1 px-1 text-xs text-danger"
                >
                  {urlError}
                </p>
              )}
            </div>
          </div>
          {addError && (
            <p role="alert" className="text-xs text-danger">
              {addError}
            </p>
          )}
          <Button
            className="h-11 w-full"
            isLoading={applyingKey === 'add'}
            disabled={!customUrl.trim()}
            onClick={() => void handleAdd()}
          >
            Verify & Add
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && !applyingKey && setDeleteTarget(null)}
      >
        <DialogContent position="bottom">
          <DialogHeader>
            <DialogTitle>Remove Custom Node?</DialogTitle>
            <DialogDescription>
              {status?.mode === 'fixed' && status.selectedEndpointId === deleteTarget?.id
                ? 'Removing this node returns Broadcast Node to Auto.'
                : 'Remove this node from your saved list?'}
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p role="alert" className="text-xs text-danger">
              {actionError}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={!!applyingKey}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1"
              isLoading={applyingKey === 'remove'}
              onClick={() => void handleRemove()}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
