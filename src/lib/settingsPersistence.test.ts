import { describe, expect, it, vi } from 'vitest'
import { SettingsPersistenceQueue } from './settingsPersistence'

interface Settings {
  theme: string
  width: string
  toolbar: boolean
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('SettingsPersistenceQueue', () => {
  it('serializes writes and coalesces patches queued behind the active one', async () => {
    const first = deferred<Settings>()
    const second = deferred<Settings>()
    const write = vi
      .fn<(patch: Partial<Settings>) => Promise<Settings>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const queue = new SettingsPersistenceQueue(write)

    const firstResult = queue.enqueue({ theme: 'dark' })
    await Promise.resolve()
    const widthResult = queue.enqueue({ width: 'wide' })
    const toolbarResult = queue.enqueue({ toolbar: false })
    expect(write).toHaveBeenCalledTimes(1)

    first.resolve({ theme: 'dark', width: 'full', toolbar: true })
    await firstResult
    expect(write).toHaveBeenLastCalledWith({ width: 'wide', toolbar: false })

    const latest = { theme: 'dark', width: 'wide', toolbar: false }
    second.resolve(latest)
    await expect(widthResult).resolves.toEqual(latest)
    await expect(toolbarResult).resolves.toEqual(latest)
  })

  it('continues with a newer batch after an earlier write fails', async () => {
    const first = deferred<Settings>()
    const write = vi
      .fn<(patch: Partial<Settings>) => Promise<Settings>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ theme: 'light', width: 'wide', toolbar: true })
    const queue = new SettingsPersistenceQueue(write)

    const failed = queue.enqueue({ theme: 'light' })
    await Promise.resolve()
    const recovered = queue.enqueue({ width: 'wide' })
    first.reject(new Error('disk full'))

    await expect(failed).rejects.toThrow('disk full')
    await expect(recovered).resolves.toMatchObject({ width: 'wide' })
  })
})
