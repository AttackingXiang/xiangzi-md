export type UndoAttempt =
  | { kind: 'undone' }
  | { kind: 'empty' | 'busy' }
  | { kind: 'failed'; error: unknown }

/** Keeps an undo entry until its inverse operation actually succeeds. */
export class RetriableUndoStack<Item> {
  private readonly items: Item[] = []
  private running = false

  get canUndo(): boolean {
    return this.items.length > 0
  }

  push(item: Item): void {
    this.items.push(item)
  }

  async undo(run: (item: Item) => Promise<void>): Promise<UndoAttempt> {
    if (this.running) return { kind: 'busy' }
    const item = this.items.at(-1)
    if (item === undefined) return { kind: 'empty' }
    this.running = true
    try {
      await run(item)
      const index = this.items.lastIndexOf(item)
      if (index >= 0) this.items.splice(index, 1)
      return { kind: 'undone' }
    } catch (error) {
      return { kind: 'failed', error }
    } finally {
      this.running = false
    }
  }
}
