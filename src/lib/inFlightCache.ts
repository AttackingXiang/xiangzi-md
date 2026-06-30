export class InFlightCache<K, V> {
  private readonly values = new Map<K, Promise<V>>()

  get size(): number {
    return this.values.size
  }

  get(key: K): Promise<V> | undefined {
    return this.values.get(key)
  }

  getOrCreate(key: K, factory: () => Promise<V>): Promise<V> {
    const existing = this.values.get(key)
    if (existing) return existing

    const promise = Promise.resolve()
      .then(factory)
      .finally(() => {
        if (this.values.get(key) === promise) this.values.delete(key)
      })
    this.values.set(key, promise)
    return promise
  }
}
