export class ForegroundEngagementTracker {
  private activeSince: number | null
  private accumulatedMs = 0

  constructor(active: boolean, now: number) {
    this.activeSince = active ? now : null
  }

  setActive(active: boolean, now: number): void {
    if (active) {
      if (this.activeSince === null) this.activeSince = now
      return
    }
    this.accumulate(now)
    this.activeSince = null
  }

  pending(now: number): number {
    return Math.max(
      0,
      Math.floor(
        this.accumulatedMs + (this.activeSince === null ? 0 : Math.max(0, now - this.activeSince))
      )
    )
  }

  take(now: number): number {
    this.accumulate(now)
    const elapsed = Math.max(0, Math.floor(this.accumulatedMs))
    this.accumulatedMs = 0
    if (this.activeSince !== null) this.activeSince = now
    return elapsed
  }

  private accumulate(now: number): void {
    if (this.activeSince === null) return
    this.accumulatedMs += Math.max(0, now - this.activeSince)
    this.activeSince = now
  }
}
