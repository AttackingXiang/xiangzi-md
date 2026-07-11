import { describe, expect, it } from 'vitest'
import { buildRecentRank, sortNodes, type SortContext } from './fileTreeSort'
import type { FileNode } from '../types'

function node(partial: Partial<FileNode> & { name: string; path: string }): FileNode {
  return {
    isDir: false,
    openable: true,
    modifiedNanos: 0,
    ...partial,
  }
}

const ctx = (over: Partial<SortContext> = {}): SortContext => ({
  mode: 'default',
  pinnedPaths: new Set(),
  recentRank: new Map(),
  ...over,
})

const names = (nodes: FileNode[]): string[] => nodes.map((n) => n.name)

describe('sortNodes', () => {
  const dirA = node({ name: 'alpha', path: '/w/alpha', isDir: true, modifiedNanos: 10 })
  const dirB = node({ name: 'beta', path: '/w/beta', isDir: true, modifiedNanos: 40 })
  const fileA = node({ name: 'a.md', path: '/w/a.md', modifiedNanos: 30 })
  const fileB = node({ name: 'b.md', path: '/w/b.md', modifiedNanos: 20 })
  const fileC = node({ name: 'c.md', path: '/w/c.md', modifiedNanos: 50 })
  const input = [fileC, dirB, fileA, dirA, fileB]

  it('default: folders first, then name ascending', () => {
    expect(names(sortNodes(input, ctx()))).toEqual(['alpha', 'beta', 'a.md', 'b.md', 'c.md'])
  })

  it('nameDesc: folders first, names descending within each group', () => {
    expect(names(sortNodes(input, ctx({ mode: 'nameDesc' })))).toEqual([
      'beta',
      'alpha',
      'c.md',
      'b.md',
      'a.md',
    ])
  })

  it('modified: newest first, folders still ahead of files', () => {
    // folders by mtime desc: beta(40) > alpha(10); files: c(50) > a(30) > b(20)
    expect(names(sortNodes(input, ctx({ mode: 'modified' })))).toEqual([
      'beta',
      'alpha',
      'c.md',
      'a.md',
      'b.md',
    ])
  })

  it('opened: recently-opened files rank first, unopened fall back to name', () => {
    const recentRank = buildRecentRank(['/w/b.md', '/w/c.md'])
    // opened order: b then c; a.md unopened → after, by name
    expect(names(sortNodes(input, ctx({ mode: 'opened', recentRank })))).toEqual([
      'alpha',
      'beta',
      'b.md',
      'c.md',
      'a.md',
    ])
  })

  it('opened: folders rank by their most-recently-opened inner file', () => {
    // dirA 内含 c.md（rank 高/更近），dirB 内含 b.md（rank 低/更旧）
    const treeA = node({
      name: 'alpha',
      path: '/w/alpha',
      isDir: true,
      children: [node({ name: 'c.md', path: '/w/alpha/c.md' })],
    })
    const treeB = node({
      name: 'beta',
      path: '/w/beta',
      isDir: true,
      children: [node({ name: 'b.md', path: '/w/beta/b.md' })],
    })
    const recentRank = buildRecentRank(['/w/alpha/c.md', '/w/beta/b.md'])
    // alpha 的内部文件更近 → alpha 排在 beta 前；文件夹整体仍在文件前
    expect(names(sortNodes([treeB, treeA, fileA], ctx({ mode: 'opened', recentRank })))).toEqual([
      'alpha',
      'beta',
      'a.md',
    ])
  })

  it('opened: folder ranks from global recentRank even when children are not loaded', () => {
    // 懒加载场景：文件夹节点没有 children，但 recentRank 里有它内部文件的记录
    const collapsedA = node({ name: 'alpha', path: '/w/alpha', isDir: true })
    const collapsedB = node({ name: 'beta', path: '/w/beta', isDir: true })
    const recentRank = buildRecentRank(['/w/beta/deep/note.md', '/w/alpha/x.md'])
    // beta 的内部文件更近（rank 0）→ beta 在前
    expect(names(sortNodes([collapsedA, collapsedB], ctx({ mode: 'opened', recentRank })))).toEqual([
      'beta',
      'alpha',
    ])
  })

  it('modified: folder inherits the newest mtime among its inner files', () => {
    // 文件夹自身 mtime 都是 0，靠内部文件冒泡
    const treeOld = node({
      name: 'alpha',
      path: '/w/alpha',
      isDir: true,
      children: [node({ name: 'x.md', path: '/w/alpha/x.md', modifiedNanos: 10 })],
    })
    const treeNew = node({
      name: 'beta',
      path: '/w/beta',
      isDir: true,
      children: [node({ name: 'y.md', path: '/w/beta/y.md', modifiedNanos: 90 })],
    })
    expect(names(sortNodes([treeOld, treeNew], ctx({ mode: 'modified' })))).toEqual(['beta', 'alpha'])
  })

  it('pins folders to the top of their group regardless of mode', () => {
    const pinnedPaths = new Set(['/w/beta'])
    const out = names(sortNodes(input, ctx({ pinnedPaths })))
    expect(out[0]).toBe('beta')
    // remaining folder + files keep default order after the pinned one
    expect(out).toEqual(['beta', 'alpha', 'a.md', 'b.md', 'c.md'])
  })

  it('does not mutate the input array', () => {
    const copy = [...input]
    sortNodes(input, ctx({ mode: 'modified' }))
    expect(input).toEqual(copy)
  })
})

describe('buildRecentRank', () => {
  it('maps most-recent path to rank 0 and dedupes', () => {
    const rank = buildRecentRank(['/x', '/y', '/x'])
    expect(rank.get('/x')).toBe(0)
    expect(rank.get('/y')).toBe(1)
  })
})
