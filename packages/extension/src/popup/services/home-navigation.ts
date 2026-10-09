export type HomeDefaultTab = 'assets' | 'activity'

export function resolveHomeDefaultTab(search: string): HomeDefaultTab {
  return new URLSearchParams(search).get('tab') === 'activity' ? 'activity' : 'assets'
}
