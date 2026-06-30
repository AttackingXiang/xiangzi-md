import { describe, expect, it, vi } from 'vitest'
import { InFlightCache } from './inFlightCache'

describe('InFlightCache', () => {
  it('deduplicates active work and releases successful values', async () => {
    const cache = new InFlightCache<string, number>()
    const factory = vi.fn(() => Promise.resolve(42))
    const first = cache.getOrCreate('image', factory)
    const second = cache.getOrCreate('image', factory)

    expect(second).toBe(first)
    await expect(first).resolves.toBe(42)
    expect(factory).toHaveBeenCalledOnce()
    expect(cache.size).toBe(0)
  })

  it('also releases rejected work so it can be retried', async () => {
    const cache = new InFlightCache<string, number>()
    await expect(
      cache.getOrCreate('image', () => Promise.reject(new Error('decode failed'))),
    ).rejects.toThrow('decode failed')
    expect(cache.size).toBe(0)
    await expect(cache.getOrCreate('image', () => Promise.resolve(7))).resolves.toBe(7)
  })
})
