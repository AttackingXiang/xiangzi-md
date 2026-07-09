import { describe, expect, it } from 'vitest'
import { buildTagTree, countTagTreeNodes, type TagTreeEntry } from './tagTree'

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
