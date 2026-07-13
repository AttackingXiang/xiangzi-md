import { EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import {
  planHeadingReorder,
  reorderHeading,
  reorderHeadingSource,
  revealHeading,
  sourceHeadings,
} from './outline'

describe('CM6 source outline', () => {
  it('collects exact heading offsets and ignores fenced code', () => {
    const markdown = '前言\n# 标题\n```md\n# 不是标题\n```\n## 子标题\n'
    expect(sourceHeadings(markdown)).toEqual([
      { level: 1, text: '标题', offset: 3 },
      { level: 2, text: '子标题', offset: 25 },
    ])
  })

  it('uses CommonMark heading text and excludes headings nested in quotes', () => {
    const markdown = '   # **Indented**\nEmpty\n===\n> # Quoted\n##\n'
    expect(sourceHeadings(markdown)).toEqual([
      { level: 1, text: 'Indented', offset: 0 },
      { level: 1, text: 'Empty', offset: 18 },
      { level: 2, text: '', offset: 39 },
    ])
  })

  it('moves a complete section down', () => {
    const markdown = '# A\n\nA body\n\n# B\n\nB body\n'
    expect(reorderHeadingSource(markdown, 0, 1)).toBe('# B\n\nB body\n# A\n\nA body\n\n')
  })

  it('keeps nested headings with their parent section', () => {
    const markdown = '# A\n## A.1\nbody\n# B\nbody\n'
    expect(reorderHeadingSource(markdown, 0, 2)).toBe('# B\nbody\n# A\n## A.1\nbody\n')
  })

  it('returns no plan for invalid/no-op moves', () => {
    expect(planHeadingReorder('# A\n', 0, 0)).toBeNull()
    expect(planHeadingReorder('# A\n', 0, 4)).toBeNull()
  })

  it('produces a minimal replacement that recreates the reordered source', () => {
    const markdown = 'preamble\n# A\na\n# B\nb\ntail'
    const plan = planHeadingReorder(markdown, 1, 0)
    expect(plan).not.toBeNull()
    const change = plan!.change as { from: number; to: number; insert: string }
    const applied = markdown.slice(0, change.from) + change.insert + markdown.slice(change.to)
    expect(applied).toBe(plan!.markdown)
    expect(change.from).toBeGreaterThanOrEqual('preamble\n'.length)
  })

  it('refuses programmatic heading reorders in a read-only editor', () => {
    const state = EditorState.create({
      doc: '# A\n# B\n',
      extensions: EditorState.readOnly.of(true),
    })
    const dispatch = vi.fn()
    const focus = vi.fn()

    expect(reorderHeading({ state, dispatch, focus } as never, 0, 1)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })

  it('reveals a clamped offset through a CM6 scroll effect', () => {
    const state = EditorState.create({ doc: '# 标题\n正文' })
    const dispatch = vi.fn<(spec: { selection?: { anchor: number } }) => void>()
    const focus = vi.fn()
    const view = { state, dispatch, focus }
    expect(revealHeading(view as never, 10_000)).toBe(true)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: state.doc.length })
    expect(focus).toHaveBeenCalledOnce()
  })

  it('places the caret after a hidden ATX marker while scrolling the source line', () => {
    const state = EditorState.create({ doc: 'before\n   ## **Heading**\nafter' })
    const dispatch = vi.fn<(spec: { selection?: { anchor: number } }) => void>()
    const focus = vi.fn()
    const view = { state, dispatch, focus }

    expect(revealHeading(view as never, 'before\n'.length)).toBe(true)
    expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 'before\n   ## **'.length })
  })
})
