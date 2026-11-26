import type { ActivityScope } from '@/core/activity'
import type { ConfidentialHistoryPage } from '@/core/services/near-intents/confidential-history'

interface HistoryWindow {
  readonly pages: readonly ConfidentialHistoryPage[]
  readonly unavailable?: true
}

interface HistoryContext {
  readonly key: string
  window: HistoryWindow
  pending?: { pageCount?: number; promise: Promise<HistoryWindow> }
}

const EMPTY: HistoryWindow = { pages: [] }

export class ConfidentialHistoryCache {
  private context?: HistoryContext

  constructor(
    private readonly readPage: (
      scope: ActivityScope,
      prevCursor: string | undefined,
      isCurrent: () => Promise<boolean>
    ) => Promise<ConfidentialHistoryPage | null>
  ) {}

  clear(): void {
    this.context = undefined
  }

  async read(
    scope: ActivityScope,
    isActiveScope: () => Promise<boolean>,
    refresh: boolean,
    pageCount?: number
  ): Promise<HistoryWindow> {
    const key = JSON.stringify([scope.keyDomainId, scope.accountId])
    if (this.context?.key !== key) this.context = { key, window: EMPTY }
    const context = this.context
    if (!refresh) return context.window
    while (context.pending) {
      if (context.pending.pageCount === pageCount) return context.pending.promise
      await context.pending.promise.catch(() => {})
      if (this.context !== context) return EMPTY
    }
    const existing = context.window
    const extend = pageCount !== undefined && existing.pages.length > 0
    if (extend && existing.pages.length >= pageCount) return existing
    const target = pageCount ?? Math.max(1, existing.pages.length)
    const isCurrent = async () =>
      this.context === context && (await isActiveScope()) && this.context === context
    const promise = this.refresh(scope, context, isCurrent, target, extend).finally(() => {
      context.pending = undefined
    })
    context.pending = { pageCount, promise }
    return promise
  }

  private async refresh(
    scope: ActivityScope,
    context: HistoryContext,
    isCurrent: () => Promise<boolean>,
    target: number,
    extend: boolean
  ): Promise<HistoryWindow> {
    const existing = context.window
    const pages = extend ? [...existing.pages] : []
    const requestedCursors = new Set<string>()
    for (const page of pages.slice(0, -1)) {
      if (page.prevCursor) requestedCursors.add(page.prevCursor)
    }
    try {
      while (pages.length < target) {
        if (!(await isCurrent())) return EMPTY
        const prevCursor = pages.at(-1)?.prevCursor
        if (pages.length && (!prevCursor || requestedCursors.has(prevCursor))) break
        if (prevCursor) requestedCursors.add(prevCursor)
        const page = await this.readPage(scope, prevCursor, isCurrent)
        if (!(await isCurrent())) return EMPTY
        if (!page) {
          context.window = EMPTY
          return context.window
        }
        pages.push(
          page.prevCursor && requestedCursors.has(page.prevCursor)
            ? { entries: page.entries }
            : page
        )
      }
      context.window = { pages }
    } catch {
      if (!(await isCurrent())) return EMPTY
      if (extend) throw new Error('Could not load older Confidential activity')
      context.window = { ...existing, unavailable: true }
    }
    return context.window
  }
}
