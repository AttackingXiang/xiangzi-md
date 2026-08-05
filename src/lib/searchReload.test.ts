import { describe, expect, it } from 'vitest'
import { recordContentChanges } from './searchReload'

const file = (path: string, contentHash: string) => ({ path, contentHash })

describe('recordContentChanges', () => {
  it('does not report a change when a new file is opened', () => {
    // 点开一条搜索结果就会新增一个标签页。若这算作"变化"，搜索结果会被清空并
    // 重跑全量搜索——用户每点一条结果列表就闪一次。
    const known = new Map<string, string>()
    expect(recordContentChanges(known, [file('/a.md', 'h1')])).toBe(false)
    expect(recordContentChanges(known, [file('/a.md', 'h1'), file('/b.md', 'h2')])).toBe(false)
  })

  it('reports a change when a known file is saved with new content', () => {
    const known = new Map<string, string>()
    recordContentChanges(known, [file('/a.md', 'h1')])
    expect(recordContentChanges(known, [file('/a.md', 'h2')])).toBe(true)
  })

  it('does not report a change when tabs merely close', () => {
    const known = new Map<string, string>()
    recordContentChanges(known, [file('/a.md', 'h1'), file('/b.md', 'h2')])
    expect(recordContentChanges(known, [file('/a.md', 'h1')])).toBe(false)
  })

  it('ignores unsaved buffers that have no path', () => {
    const known = new Map<string, string>()
    expect(recordContentChanges(known, [{ path: null, contentHash: '' }])).toBe(false)
    expect(known.size).toBe(0)
  })
})
