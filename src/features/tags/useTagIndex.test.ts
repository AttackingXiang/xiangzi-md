import { describe, expect, it } from 'vitest'
import { planScan, type ListedScanFile, type TagScanCache } from './useTagIndex'
import type { DocumentMeta } from './types'

function makeMeta(path: string): DocumentMeta {
  return {
    path,
    name: path.split('/').pop() ?? path,
    title: path,
    excerpt: '',
    updatedAt: 0,
    tags: [],
  }
}

function makeCache(entries: Array<[string, number, DocumentMeta]>): TagScanCache {
  const cache: TagScanCache = new Map()
  for (const [path, modifiedNanos, meta] of entries) {
    cache.set(path, { modifiedNanos, meta })
  }
  return cache
}

describe('planScan', () => {
  it('复用 mtime 相等的缓存命中，不放进 toRead', () => {
    const meta = makeMeta('/root/a.md')
    const cache = makeCache([['/root/a.md', 100, meta]])
    const files: ListedScanFile[] = [{ path: '/root/a.md', name: 'a.md', modifiedNanos: 100 }]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([meta])
    expect(plan.toRead).toEqual([])
    expect(plan.stalePaths).toEqual([])
  })

  it('mtime 变了要重读，即使路径命中缓存', () => {
    const meta = makeMeta('/root/a.md')
    const cache = makeCache([['/root/a.md', 100, meta]])
    const files: ListedScanFile[] = [{ path: '/root/a.md', name: 'a.md', modifiedNanos: 200 }]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([])
    expect(plan.toRead).toEqual([{ path: '/root/a.md', name: 'a.md' }])
    expect(plan.stalePaths).toEqual([])
  })

  it('缓存里没有的新文件要重读', () => {
    const cache = makeCache([])
    const files: ListedScanFile[] = [{ path: '/root/new.md', name: 'new.md', modifiedNanos: 1 }]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([])
    expect(plan.toRead).toEqual([{ path: '/root/new.md', name: 'new.md' }])
    expect(plan.stalePaths).toEqual([])
  })

  it('缓存里有但本次列表没有的路径要被剔除', () => {
    const metaA = makeMeta('/root/a.md')
    const metaGone = makeMeta('/root/gone.md')
    const cache = makeCache([
      ['/root/a.md', 100, metaA],
      ['/root/gone.md', 50, metaGone],
    ])
    const files: ListedScanFile[] = [{ path: '/root/a.md', name: 'a.md', modifiedNanos: 100 }]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([metaA])
    expect(plan.toRead).toEqual([])
    expect(plan.stalePaths).toEqual(['/root/gone.md'])
  })

  it('mtime 倒退（变小）也当作变化处理，走重读而不是复用', () => {
    const meta = makeMeta('/root/a.md')
    const cache = makeCache([['/root/a.md', 200, meta]])
    const files: ListedScanFile[] = [{ path: '/root/a.md', name: 'a.md', modifiedNanos: 100 }]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([])
    expect(plan.toRead).toEqual([{ path: '/root/a.md', name: 'a.md' }])
  })

  it('混合场景：命中、变化、新增、剔除同时发生', () => {
    const hit = makeMeta('/root/hit.md')
    const changed = makeMeta('/root/changed.md')
    const gone = makeMeta('/root/gone.md')
    const cache = makeCache([
      ['/root/hit.md', 10, hit],
      ['/root/changed.md', 20, changed],
      ['/root/gone.md', 30, gone],
    ])
    const files: ListedScanFile[] = [
      { path: '/root/hit.md', name: 'hit.md', modifiedNanos: 10 },
      { path: '/root/changed.md', name: 'changed.md', modifiedNanos: 21 },
      { path: '/root/new.md', name: 'new.md', modifiedNanos: 1 },
    ]

    const plan = planScan(files, cache)

    expect(plan.cached).toEqual([hit])
    expect(plan.toRead).toEqual([
      { path: '/root/changed.md', name: 'changed.md' },
      { path: '/root/new.md', name: 'new.md' },
    ])
    expect(plan.stalePaths).toEqual(['/root/gone.md'])
  })
})
