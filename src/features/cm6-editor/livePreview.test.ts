import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildLivePreviewDecorations, safeMarkdownLinkHref } from './livePreview'

interface SeenDecoration {
  from: number
  to: number
  className?: string
  replacement: boolean
  href?: string
}

function decorations(state: EditorState, from: number, to: number): SeenDecoration[] {
  const result: SeenDecoration[] = []
  buildLivePreviewDecorations(state, [{ from, to }], { viewportMargin: 0 }).between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo, value) => {
      const spec = value.spec as { class?: unknown; attributes?: Record<string, string> }
      const className = typeof spec.class === 'string' ? spec.class : undefined
      result.push({
        from: rangeFrom,
        to: rangeTo,
        className,
        replacement: rangeTo > rangeFrom && className === undefined,
        href: spec.attributes?.['data-xmd-href'],
      })
    },
  )
  return result
}

function createState(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  })
}

describe('CM6 Markdown live preview', () => {
  it('only decorates syntax inside the requested viewport', () => {
    const doc = '# Visible\n\n' + 'plain\n'.repeat(80) + '# Outside'
    const state = createState(doc, doc.indexOf('plain'))
    const firstLineEnd = doc.indexOf('\n')
    const seen = decorations(state, 0, firstLineEnd)

    expect(seen.some((item) => item.className === 'xmd-cm-heading xmd-cm-heading-1')).toBe(true)
    expect(seen.every((item) => item.from <= firstLineEnd)).toBe(true)
  })

  it('hides strong markers outside the active syntax range', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)

    expect(seen.filter((item) => item.replacement && item.to - item.from === 2)).toHaveLength(2)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('keeps source markers visible while editing the construct', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, 4)
    const seen = decorations(state, 0, doc.length)

    expect(seen.some((item) => item.replacement)).toBe(false)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('uses GFM nodes for strikethrough and task list preview', () => {
    const doc = '- [x] done\n\n~~removed~~'
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)

    expect(seen.some((item) => item.className === 'xmd-cm-strikethrough')).toBe(true)
    expect(seen.some((item) => item.replacement && item.to - item.from === 3)).toBe(true)
  })

  it('adds safe href semantics only to an inactive visible link label', () => {
    const doc = '[visible](https://example.com) and [outside](../note.md)'
    const firstEnd = doc.indexOf(' and ')
    const state = createState(doc, firstEnd + 2)
    const seen = decorations(state, 0, firstEnd)

    expect(seen.find((item) => item.href)?.href).toBe('https://example.com')
    expect(seen.every((item) => item.from <= firstEnd)).toBe(true)
  })

  it('keeps link source editable and removes click semantics while active', () => {
    const doc = '[label](../note.md)'
    const seen = decorations(createState(doc, 3), 0, doc.length)

    expect(seen.some((item) => item.href)).toBe(false)
    expect(seen.some((item) => item.replacement)).toBe(false)
  })

  it('allows web, mail and relative links but rejects unsafe protocols', () => {
    expect(safeMarkdownLinkHref('https://example.com')).toBe('https://example.com')
    expect(safeMarkdownLinkHref('mailto:user@example.com')).toBe('mailto:user@example.com')
    expect(safeMarkdownLinkHref('../note.md#part')).toBe('../note.md#part')
    expect(safeMarkdownLinkHref('javascript:alert(1)')).toBeNull()
    expect(safeMarkdownLinkHref('data:text/html,bad')).toBeNull()
    expect(safeMarkdownLinkHref('//example.com/path')).toBeNull()
  })
})
