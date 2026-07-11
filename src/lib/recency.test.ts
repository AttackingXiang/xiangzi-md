import { describe, expect, it } from 'vitest'
import { buildFrecencyRank, recencyBlend } from './recency'
import type { RecentDoc } from '../types'

const DAY = 24 * 60 * 60 * 1_000_000_000
const NOW = 1_000 * DAY // 一个足够大的“现在”，避免 age 为负

const doc = (partial: Partial<RecentDoc> & { path: string }): RecentDoc => ({
  openCount: 1,
  lastOpenedNanos: NOW,
  lastEditedNanos: 0,
  ...partial,
})

const order = (rank: Map<string, number>): string[] =>
  Array.from(rank.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([path]) => path)

describe('buildFrecencyRank', () => {
  it('frequency beats a single more-recent open (frecency, not pure MRU)', () => {
    // hot：一周内开了 20 次，最近一次是 2 天前；cold：刚刚开了 1 次
    const docs = [
      doc({ path: 'hot', openCount: 20, lastOpenedNanos: NOW - 2 * DAY }),
      doc({ path: 'cold', openCount: 1, lastOpenedNanos: NOW }),
    ]
    expect(order(buildFrecencyRank(docs, NOW))).toEqual(['hot', 'cold'])
  })

  it('more recent open wins when frequency is equal', () => {
    const docs = [
      doc({ path: 'older', openCount: 1, lastOpenedNanos: NOW - 10 * DAY }),
      doc({ path: 'newer', openCount: 1, lastOpenedNanos: NOW - 1 * DAY }),
    ]
    expect(order(buildFrecencyRank(docs, NOW))).toEqual(['newer', 'older'])
  })

  it('edit recency lifts a doc above a same-frequency unedited one', () => {
    const docs = [
      doc({ path: 'read', openCount: 1, lastOpenedNanos: NOW - 3 * DAY }),
      doc({
        path: 'edited',
        openCount: 1,
        lastOpenedNanos: NOW - 3 * DAY,
        lastEditedNanos: NOW - 1 * DAY,
      }),
    ]
    expect(order(buildFrecencyRank(docs, NOW))).toEqual(['edited', 'read'])
  })

  it('currently-open tabs are boosted to the top regardless of frecency', () => {
    const docs = [
      doc({ path: 'hot', openCount: 50, lastOpenedNanos: NOW }),
      doc({ path: 'openNow', openCount: 1, lastOpenedNanos: NOW - 30 * DAY }),
    ]
    const rank = buildFrecencyRank(docs, NOW, new Set(['openNow']))
    expect(rank.get('openNow')).toBe(0)
  })

  it('includes an open tab that was never recorded', () => {
    const rank = buildFrecencyRank([], NOW, new Set(['/unsaved.md']))
    expect(rank.get('/unsaved.md')).toBe(0)
  })

  it('empty corpus yields an empty rank map', () => {
    expect(buildFrecencyRank([], NOW).size).toBe(0)
  })
})

describe('recencyBlend', () => {
  it('rewards a hit rank within the window, decaying by position', () => {
    expect(recencyBlend(0, 0, 0)).toBeGreaterThan(recencyBlend(10, 0, 0))
  })

  it('ignores ranks beyond the window (clamped to 0 open-contribution)', () => {
    expect(recencyBlend(999, 0, 0)).toBe(0)
  })

  it('adds a normalized modified-time contribution', () => {
    // newest mtime 拿满 0.5 权重，一半 mtime 拿 0.25
    expect(recencyBlend(undefined, 100, 100)).toBeCloseTo(0.5)
    expect(recencyBlend(undefined, 50, 100)).toBeCloseTo(0.25)
  })

  it('returns 0 when there is no signal at all', () => {
    expect(recencyBlend(undefined, 0, 0)).toBe(0)
  })
})
