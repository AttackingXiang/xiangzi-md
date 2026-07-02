interface TaskState<T> {
  next: (() => Promise<T>) | null
  promise: Promise<T>
}

/** Serializes work per key and coalesces queued work to the newest requested task. */
export class LatestTaskQueue<Key, Value> {
  private readonly states = new Map<Key, TaskState<Value>>()

  run(key: Key, task: () => Promise<Value>): Promise<Value> {
    const existing = this.states.get(key)
    if (existing) {
      existing.next = task
      return existing.promise
    }

    const state = {} as TaskState<Value>
    state.next = task
    state.promise = (async () => {
      let value!: Value
      while (state.next) {
        const current = state.next
        state.next = null
        value = await current()
      }
      return value
    })().finally(() => {
      if (this.states.get(key) === state) this.states.delete(key)
    })
    this.states.set(key, state)
    return state.promise
  }
}
