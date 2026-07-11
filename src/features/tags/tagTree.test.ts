import { describe, expect, it } from 'vitest'
import {
  buildTagTree,
  countTagTreeNodes,
  groupKeysToCollapse,
  isTagInSubtree,
  type TagTreeEntry,
} from './tagTree'

const entry = (key: string, docPaths: string[], label = key): TagTreeEntry => ({
  key,
  label,
  docPaths,
})

describe('buildTagTree', () => {
  it('nests a/b and a/c under a', () => {
    const tree = buildTagTree([entry('project/work', ['w.md']), entry('project/home', ['h.md'])])
    expect(tree).toHaveLength(1)
    const project = tree[0]
    expect(project.key).toBe('project')
    expect(project.selfCount).toBe(0) // 没有文档直接打 #project
    expect(project.totalCount).toBe(2) // work + home 两篇
    expect(project.children.map((c) => c.key)).toEqual(['project/home', 'project/work'])
  })

  it('a parent that is also a real tag keeps its own selfCount plus children', () => {
    const tree = buildTagTree([entry('project', ['a.md', 'b.md']), entry('project/work', ['c.md'])])
    const project = tree[0]
    expect(project.selfCount).toBe(2)
    expect(project.totalCount).toBe(3)
    expect(project.children).toHaveLength(1)
    expect(project.children[0].key).toBe('project/work')
  })

  it('groupsFirst puts tags with children before leaf tags at each level', () => {
    // zzz 是叶子且文档更多；aaa 有子标签。默认按 totalCount，zzz 在前；groupsFirst 反之。
    const entries = [entry('zzz', ['1.md', '2.md', '3.md']), entry('aaa/sub', ['4.md'])]
    const byCount = buildTagTree(entries)
    expect(byCount.map((n) => n.key)).toEqual(['zzz', 'aaa'])
    const groupsFirst = buildTagTree(entries, { groupsFirst: true })
    expect(groupsFirst.map((n) => n.key)).toEqual(['aaa', 'zzz'])
  })

  it('groupKeysToCollapse returns group nodes at/deeper than the given depth', () => {
    const tree = buildTagTree([
      entry('a/b/c', ['1.md']),
      entry('a/d', ['2.md']),
      entry('solo', ['3.md']),
    ])
    // -1：全部展开（空）
    expect(groupKeysToCollapse(tree, -1)).toEqual([])
    // 0：折叠所有分组（solo 是叶子，不算分组）
    expect(new Set(groupKeysToCollapse(tree, 0))).toEqual(new Set(['a', 'a/b']))
    // 1：只折叠深度 ≥1 的分组
    expect(groupKeysToCollapse(tree, 1)).toEqual(['a/b'])
    // 2：没有深度 ≥2 的分组
    expect(groupKeysToCollapse(tree, 2)).toEqual([])
  })

  it('deduplicates docs across the subtree in totalCount', () => {
    const tree = buildTagTree([
      entry('a/b', ['doc.md']),
      entry('a/c', ['doc.md']), // 同一篇文档同时有 a/b 和 a/c
    ])
    expect(tree[0].totalCount).toBe(1)
  })

  it('preserves original casing of the display segment, incl. for group placeholders', () => {
    const tree = buildTagTree([entry('project/work', ['w.md'], 'Project/Work')])
    expect(tree[0].segment).toBe('Project')
    expect(tree[0].children[0].segment).toBe('Work')
    expect(tree[0].children[0].fullLabel).toBe('Project/Work')
  })

  it('sorts siblings by total count desc then name', () => {
    const tree = buildTagTree([
      entry('x', ['1.md']),
      entry('y', ['1.md', '2.md']),
      entry('z', ['1.md', '2.md']),
    ])
    expect(tree.map((n) => n.key)).toEqual(['y', 'z', 'x'])
  })

  it('sort=name orders siblings by name asc (count as tiebreak)', () => {
    const entries = [entry('x', ['1.md']), entry('y', ['1.md', '2.md']), entry('z', ['1.md'])]
    expect(buildTagTree(entries, { sort: 'name' }).map((n) => n.key)).toEqual(['x', 'y', 'z'])
  })

  it('sort=nameDesc orders siblings by name desc', () => {
    const entries = [entry('x', ['1.md']), entry('y', ['1.md', '2.md']), entry('z', ['1.md'])]
    expect(buildTagTree(entries, { sort: 'nameDesc' }).map((n) => n.key)).toEqual(['z', 'y', 'x'])
  })

  it('sort=smart ranks tags by most-recently-opened doc, then by newest mtime', () => {
    // low 只有一篇没打开的旧文档；high 有一篇最近打开的文档
    const entries = [entry('low', ['old.md']), entry('high', ['fresh.md'])]
    const recentRank = new Map([['fresh.md', 0]])
    const mtimeByPath = new Map([
      ['old.md', 10],
      ['fresh.md', 5],
    ])
    const out = buildTagTree(entries, { sort: 'smart', recentRank, mtimeByPath })
    expect(out.map((n) => n.key)).toEqual(['high', 'low'])
  })

  it('sort=smart falls back to mtime when nothing was opened', () => {
    const entries = [entry('older', ['a.md']), entry('newer', ['b.md'])]
    const mtimeByPath = new Map([
      ['a.md', 1],
      ['b.md', 99],
    ])
    const out = buildTagTree(entries, { sort: 'smart', mtimeByPath })
    expect(out.map((n) => n.key)).toEqual(['newer', 'older'])
  })

  it('groupsFirst stays orthogonal to sort=name', () => {
    // zzz 叶子、aaa 有子标签；分组优先应把 aaa 顶到前，即使 name 升序会让 aaa 本就在前
    const entries = [entry('zzz', ['1.md']), entry('aaa/child', ['2.md'])]
    const out = buildTagTree(entries, { sort: 'name', groupsFirst: true })
    expect(out.map((n) => n.key)).toEqual(['aaa', 'zzz'])
  })

  it('nests a single 3-level tag (Claude/test/wap) all the way down', () => {
    const tree = buildTagTree([entry('claude/test/wap', ['a.md'], 'Claude/test/wap')])
    expect(tree.map((n) => n.key)).toEqual(['claude'])
    const test = tree[0].children[0]
    expect(test.key).toBe('claude/test')
    expect(test.children.map((n) => n.key)).toEqual(['claude/test/wap']) // test 下有 wap 分支
    expect(test.children[0].selfCount).toBe(1)
  })

  it('handles a flat (non-nested) tag as a single leaf', () => {
    const tree = buildTagTree([entry('claude', ['a.md', 'b.md'])])
    expect(tree).toEqual([
      {
        key: 'claude',
        segment: 'claude',
        fullLabel: 'claude',
        selfCount: 2,
        totalCount: 2,
        children: [],
      },
    ])
  })

  it('isTagInSubtree matches the tag itself and its descendants, not sibling prefixes', () => {
    expect(isTagInSubtree('project', 'project')).toBe(true)
    expect(isTagInSubtree('project/work', 'project')).toBe(true)
    expect(isTagInSubtree('project/work/urgent', 'project')).toBe(true)
    expect(isTagInSubtree('projectx', 'project')).toBe(false) // 不能把 projectx 也算进去
    expect(isTagInSubtree('other', 'project')).toBe(false)
  })

  it('countTagTreeNodes counts group placeholders too', () => {
    const tree = buildTagTree([
      entry('a/b', ['1.md']),
      entry('a/c', ['2.md']),
      entry('d', ['3.md']),
    ])
    // a (group) + a/b + a/c + d = 4
    expect(countTagTreeNodes(tree)).toBe(4)
  })
})
