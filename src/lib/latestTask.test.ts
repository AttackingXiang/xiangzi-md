import { describe, expect, it, vi } from 'vitest'
import { LatestTaskQueue } from './latestTask'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('LatestTaskQueue', () => {
  it('serializes a key and coalesces intermediate queued saves', async () => {
    const queue = new LatestTaskQueue<string, number>()
    const first = deferred<number>()
    const order: string[] = []
    const initial = queue.run('tab', async () => {
      order.push('first')
      return first.promise
    })
    const skipped = vi.fn(() => Promise.resolve(2))
    const latest = vi.fn(() => {
      order.push('latest')
      return Promise.resolve(3)
    })

    const second = queue.run('tab', skipped)
    const third = queue.run('tab', latest)
    first.resolve(1)

    await expect(Promise.all([initial, second, third])).resolves.toEqual([3, 3, 3])
    expect(skipped).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
    expect(order).toEqual(['first', 'latest'])
  })
})
