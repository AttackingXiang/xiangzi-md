import { describe, expect, it } from 'vitest'
import { createTaskQueue, mapWithConcurrencyLimit } from './asyncPool'

describe('asyncPool', () => {
  it('preserves result order while bounding active work', async () => {
    let active = 0
    let peak = 0
    const values = await mapWithConcurrencyLimit([3, 1, 2, 4], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return value * 2
    })

    expect(values).toEqual([6, 2, 4, 8])
    expect(peak).toBe(2)
  })

  it('releases a queue slot when a task rejects', async () => {
    const queue = createTaskQueue(1)
    await expect(queue.run(() => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
    await expect(queue.run(() => Promise.resolve('next'))).resolves.toBe('next')
  })
})
