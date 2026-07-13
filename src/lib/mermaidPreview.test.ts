import { describe, expect, it, vi } from 'vitest'
import { MermaidRenderScheduler } from './mermaidPreview'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('Mermaid render scheduling', () => {
  it('allows same-configuration diagrams to render concurrently', async () => {
    const scheduler = new MermaidRenderScheduler()
    const first = deferred<string>()
    const second = deferred<string>()
    const firstTask = vi.fn(() => first.promise)
    const secondTask = vi.fn(() => second.promise)

    const firstResult = scheduler.run('preview-light', firstTask)
    const secondResult = scheduler.run('preview-light', secondTask)
    await Promise.resolve()

    expect(firstTask).toHaveBeenCalledOnce()
    expect(secondTask).toHaveBeenCalledOnce()
    first.resolve('first')
    second.resolve('second')
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual(['first', 'second'])
  })

  it('does not overlap preview and export configurations', async () => {
    const scheduler = new MermaidRenderScheduler()
    const preview = deferred<string>()
    const exportRender = deferred<string>()
    const order: string[] = []

    const previewResult = scheduler.run('html-labels', () => {
      order.push('preview:start')
      return preview.promise.finally(() => order.push('preview:end'))
    })
    const exportResult = scheduler.run('svg-text', () => {
      order.push('export:start')
      return exportRender.promise.finally(() => order.push('export:end'))
    })
    await Promise.resolve()
    expect(order).toEqual(['preview:start'])

    preview.resolve('preview')
    await previewResult
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['preview:start', 'preview:end', 'export:start'])

    exportRender.resolve('export')
    await expect(exportResult).resolves.toBe('export')
  })

  it('continues draining after a render failure', async () => {
    const scheduler = new MermaidRenderScheduler()
    const failure = deferred<string>()
    const nextTask = vi.fn(() => Promise.resolve('recovered'))

    const failed = scheduler.run('preview', () => failure.promise)
    const recovered = scheduler.run('export', nextTask)
    failure.reject(new Error('invalid diagram'))

    await expect(failed).rejects.toThrow('invalid diagram')
    await expect(recovered).resolves.toBe('recovered')
    expect(nextTask).toHaveBeenCalledOnce()
  })
})
