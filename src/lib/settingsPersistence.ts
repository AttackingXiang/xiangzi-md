interface Waiter<Settings> {
  resolve: (settings: Settings) => void
  reject: (error: unknown) => void
}

/**
 * Serializes settings writes and merges changes waiting behind the active
 * write. Every caller resolves with the authoritative result of the batch that
 * contains its patch, so slow earlier responses can never overwrite newer UI.
 */
export class SettingsPersistenceQueue<Settings extends object> {
  private pendingPatch: Partial<Settings> | null = null
  private pendingWaiters: Array<Waiter<Settings>> = []
  private running = false

  constructor(private readonly write: (patch: Partial<Settings>) => Promise<Settings>) {}

  enqueue(patch: Partial<Settings>): Promise<Settings> {
    this.pendingPatch = { ...this.pendingPatch, ...patch }
    const promise = new Promise<Settings>((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject })
    })
    if (!this.running) {
      this.running = true
      queueMicrotask(() => void this.drain())
    }
    return promise
  }

  private async drain(): Promise<void> {
    while (this.pendingPatch) {
      const patch = this.pendingPatch
      const waiters = this.pendingWaiters
      this.pendingPatch = null
      this.pendingWaiters = []
      try {
        const settings = await this.write(patch)
        for (const waiter of waiters) waiter.resolve(settings)
      } catch (error) {
        for (const waiter of waiters) waiter.reject(error)
      }
    }
    this.running = false
    // A promise continuation can enqueue after the loop observed no work but
    // before this method returns. enqueue sees running=false and starts again.
  }
}
