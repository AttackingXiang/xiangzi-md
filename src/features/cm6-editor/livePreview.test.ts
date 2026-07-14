import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildLivePreviewDecorations,
  buildHiddenMarkdownMarkerRanges,
  cleanupEmptyMarkdownFormatting,
  editableBlankParagraph,
  headingBoundaryDeletion,
  isBlockSeparatorLine,
  listBoundaryDeletion,
  quoteBoundaryDeletion,
  safeMarkdownLinkHref,
  visualGapEdit,
} from './livePreview'

interface SeenDecoration {
  from: number
  to: number
  className?: string
  replacement: boolean
  href?: string
  style?: string
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
        style: spec.attributes?.style,
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

function deleteAsUser(state: EditorState, from: number, to: number): EditorState {
  const deletion = {
    changes: { from, to },
    annotations: Transaction.userEvent.of('delete.selection'),
  }
  const transaction = state.update(deletion)
  const cleanup = cleanupEmptyMarkdownFormatting(transaction)
  return cleanup ? state.update(deletion, cleanup).state : transaction.state
}

function deleteAtHeadingBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = headingBoundaryDeletion(state, forward)
  if (!spec) return state
  return state.update(spec).state
}

function deleteAtListBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = listBoundaryDeletion(state, forward)
  if (!spec) return state
  return state.update(spec).state
}

function deleteAtQuoteBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = quoteBoundaryDeletion(state, forward)
  if (!spec) return state
  return state.update(spec).state
}

describe('CM6 Markdown live preview', () => {
  it('turns a heading into a paragraph when Backspace is pressed at its visual left edge', () => {
    const state = createState('## Heading', 3)
    const result = deleteAtHeadingBoundary(state, false)

    expect(result.doc.toString()).toBe('Heading')
    expect(result.selection.main.head).toBe(0)
  })

  it('never creates hidden-marker deletion transactions in read-only mode', () => {
    const state = EditorState.create({
      doc: '# Heading\n- item\n> quote',
      selection: EditorSelection.cursor(2),
      extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(true)],
    })

    expect(headingBoundaryDeletion(state, false)).toBeNull()
    expect(listBoundaryDeletion(state, false)).toBeNull()
    expect(quoteBoundaryDeletion(state, false)).toBeNull()
  })

  it('deletes the first visible heading character with Delete at either atomic boundary', () => {
    for (const cursor of [0, 3]) {
      const result = deleteAtHeadingBoundary(createState('## 👍🏽Title', cursor), true)
      expect(result.doc.toString()).toBe('## Title')
      expect(result.selection.main.head).toBe(3)
    }
  })

  it('renders Setext headings as one visual row and cleans their marker when emptied', () => {
    const doc = 'Heading\n======='
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)

    expect(seen.some(({ from, className }) => from === 0 && className?.includes('heading-1'))).toBe(
      true,
    )
    expect(
      seen.some(({ from, className }) => from === 8 && className === 'xmd-cm-block-separator'),
    ).toBe(true)
    expect(isBlockSeparatorLine(state, 2)).toBe(true)
    expect(deleteAsUser(state, 0, 7).doc.toString()).toBe('')
  })

  it('turns a top-level list item into a paragraph at its visual left edge', () => {
    for (const doc of ['- item', '1. item', '- [ ] task']) {
      const cursor = doc.indexOf(doc.endsWith('task') ? 'task' : 'item')
      const result = deleteAtListBoundary(createState(doc, cursor), false)
      expect(result.doc.toString()).toBe(doc.endsWith('task') ? 'task' : 'item')
      expect(result.selection.main.head).toBe(0)
    }
  })

  it('outdents one level instead of removing a nested list marker', () => {
    const result = deleteAtListBoundary(createState('    - nested', 6), false)

    expect(result.doc.toString()).toBe('  - nested')
    expect(result.selection.main.head).toBe(4)
  })

  it('deletes one visible grapheme at a list marker boundary', () => {
    for (const cursor of [0, 2]) {
      const result = deleteAtListBoundary(createState('- 👍🏽item', cursor), true)
      expect(result.doc.toString()).toBe('- item')
      expect(result.selection.main.head).toBe(2)
    }
  })

  it('keeps quote prefixes while deleting a nested list prefix', () => {
    const doc = '> - quoted'
    const result = deleteAtListBoundary(createState(doc, doc.indexOf('quoted')), false)

    expect(result.doc.toString()).toBe('> quoted')
    expect(result.selection.main.head).toBe(2)
  })

  it('removes one quote level or one visible grapheme at the quote boundary', () => {
    const nested = deleteAtQuoteBoundary(createState('> > quoted', 4), false)
    expect(nested.doc.toString()).toBe('> quoted')
    expect(nested.selection.main.head).toBe(2)

    const deleted = deleteAtQuoteBoundary(createState('> 👍🏽quoted', 0), true)
    expect(deleted.doc.toString()).toBe('> quoted')
    expect(deleted.selection.main.head).toBe(2)
  })

  it('keeps a heading line editable after its entire visible title is deleted', () => {
    const state = EditorState.create({
      doc: '# Title\nnext',
      selection: EditorSelection.cursor(2),
      extensions: [markdown({ base: markdownLanguage }), editableBlankParagraph],
    })
    const result = deleteAsUser(state, 2, 7)

    expect(result.doc.toString()).toBe('\nnext')
    expect(result.selection.main.head).toBe(0)
    expect(result.field(editableBlankParagraph)).toBe(0)
    expect(isBlockSeparatorLine(result, 1)).toBe(false)

    const afterLeaving = result.update({ selection: EditorSelection.cursor(1) }).state
    expect(afterLeaving.field(editableBlankParagraph)).toBeNull()
    expect(isBlockSeparatorLine(afterLeaving, 1)).toBe(true)
  })

  it.each([
    ['# title', 2, 7, ''],
    ['# title #', 2, 7, ''],
    ['**bold**', 2, 6, ''],
    ['*italic*', 1, 7, ''],
    ['~~strike~~', 2, 8, ''],
    ['`code`', 1, 5, ''],
    ['[label](https://example.com)', 1, 6, ''],
  ])(
    'cleans the whole %s construct when its visible content is deleted',
    (doc, from, to, result) => {
      expect(deleteAsUser(createState(doc), from, to).doc.toString()).toBe(result)
    },
  )

  it('cleans nested markers and their empty heading in one deletion', () => {
    const doc = '# ***title***'
    const from = doc.indexOf('title')
    expect(deleteAsUser(createState(doc), from, from + 5).doc.toString()).toBe('')
  })

  it('does not clean formatting when replacement leaves visible content', () => {
    const state = createState('**bold**')
    const change = {
      changes: { from: 2, to: 6, insert: 'new' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }
    const transaction = state.update(change)
    expect(cleanupEmptyMarkdownFormatting(transaction)).toBeNull()
    expect(transaction.newDoc.toString()).toBe('**new**')
  })

  it('does not clean marker-looking text inside fenced code', () => {
    const doc = '```md\n**bold**\n```'
    const state = createState(doc)
    const from = doc.indexOf('bold')
    expect(deleteAsUser(state, from, from + 4).doc.toString()).toBe('```md\n****\n```')
  })

  it('makes every hidden Markdown marker atomic without locking rendered content', () => {
    const doc = '# **bold** and *italic* with [link](https://example.com)'
    const state = createState(doc, doc.length)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    expect(atomic).toContainEqual({ from: 0, to: 2 })
    expect(atomic).toContainEqual({ from: 2, to: 4 })
    expect(atomic).toContainEqual({ from: 8, to: 10 })
    expect(atomic.some(({ from, to }) => from <= 4 && to >= 8)).toBe(false)
    expect(atomic.every(({ from, to }) => to > from)).toBe(true)
  })

  it('only decorates syntax inside the requested viewport', () => {
    const doc = '# Visible\n\n' + 'plain\n'.repeat(80) + '# Outside'
    const state = createState(doc, doc.indexOf('plain'))
    const firstLineEnd = doc.indexOf('\n')
    const seen = decorations(state, 0, firstLineEnd)

    expect(seen.some((item) => item.className === 'xmd-cm-heading xmd-cm-heading-1')).toBe(true)
    expect(seen.every((item) => item.from <= firstLineEnd)).toBe(true)
  })

  it('always hides strong markers while preserving the rendered style', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)

    expect(seen.filter((item) => item.replacement && item.to - item.from === 2)).toHaveLength(2)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('does not reveal source markers when editing the construct', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, 4)
    const seen = decorations(state, 0, doc.length)

    expect(seen.filter((item) => item.replacement && item.to - item.from === 2)).toHaveLength(2)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('keeps heading decoration after deleting the blank line below it', () => {
    const initial = createState('# Title\n\nparagraph', 8)
    const state = initial.update({ changes: { from: 8, to: 9 } }).state
    const seen = decorations(state, 0, state.doc.line(1).to)

    expect(state.doc.toString()).toBe('# Title\nparagraph')
    expect(seen.some((item) => item.className === 'xmd-cm-heading xmd-cm-heading-1')).toBe(true)
    expect(seen.some((item) => item.replacement && item.from === 0)).toBe(true)
  })

  it('collapses block separator lines regardless of selection', () => {
    const doc = '# Title\n\nParagraph'
    const inactive = decorations(createState(doc, doc.length), 0, doc.length)
    const active = decorations(createState(doc, doc.indexOf('\n') + 1), 0, doc.length)

    expect(inactive.some((item) => item.className === 'xmd-cm-block-separator')).toBe(true)
    expect(active.some((item) => item.className === 'xmd-cm-block-separator')).toBe(true)
  })

  it('recognizes separators using Markdown block structure', () => {
    const state = createState('# Title\n\nParagraph\n\n```txt\na\n\nb\n```')
    expect(isBlockSeparatorLine(state, 2)).toBe(true)
    expect(isBlockSeparatorLine(state, 4)).toBe(true)
    expect(isBlockSeparatorLine(state, 7)).toBe(false)
  })

  it('renders document paragraphs without applying paragraph layout to lists or quotes', () => {
    const doc = 'first line\ncontinued\n\n- list item\n\n> quoted'
    const seen = decorations(createState(doc), 0, doc.length)
    const paragraphLines = seen.filter((item) => item.className?.startsWith('xmd-cm-paragraph'))

    expect(paragraphLines.map(({ from, className }) => ({ from, className }))).toEqual([
      { from: 0, className: 'xmd-cm-paragraph xmd-cm-paragraph-first' },
      {
        from: doc.indexOf('continued'),
        className: 'xmd-cm-paragraph xmd-cm-paragraph-last',
      },
    ])
  })

  it('renders only Lezer HorizontalRule nodes as thematic breaks', () => {
    const doc = 'paragraph\n\n---\n\n- - -\n\ncaption\n---'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const rules = seen.filter((item) => item.className === 'xmd-cm-horizontal-rule')
    const replacements = seen.filter((item) =>
      rules.some((rule) => item.replacement && item.from === rule.from),
    )

    expect(rules).toHaveLength(2)
    expect(replacements.map(({ from, to }) => state.doc.sliceString(from, to))).toEqual([
      '---',
      '- - -',
    ])
    expect(
      seen.some(
        (item) =>
          item.from === doc.lastIndexOf('---') && item.className === 'xmd-cm-horizontal-rule',
      ),
    ).toBe(false)
  })

  it('keeps thematic breaks atomic while leaving neighboring paragraph text editable', () => {
    const doc = 'before\n\n***\n\nafter'
    const state = createState(doc)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    expect(atomic).toEqual([{ from: doc.indexOf('***'), to: doc.indexOf('***') + 3 }])
  })

  it('keeps source unchanged while separator decorations are computed', () => {
    const doc = '# Title\n\n\nParagraph'
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), editableBlankParagraph],
    })
    decorations(state, 0, doc.length)
    expect(state.doc.toString()).toBe(doc)
  })

  it('keeps a newly inserted empty paragraph editable only while its caret remains there', () => {
    let state = EditorState.create({
      doc: 'first\nsecond',
      selection: EditorSelection.cursor(5),
      extensions: [markdown({ base: markdownLanguage }), editableBlankParagraph],
    })
    state = state.update({
      changes: { from: 5, insert: '\n' },
      selection: EditorSelection.cursor(6),
      annotations: Transaction.userEvent.of('input'),
    }).state

    expect(state.field(editableBlankParagraph)).toBe(6)
    expect(isBlockSeparatorLine(state, 2)).toBe(false)

    state = state.update({ selection: EditorSelection.cursor(0) }).state
    expect(state.field(editableBlankParagraph)).toBeNull()
    expect(isBlockSeparatorLine(state, 2)).toBe(true)
    expect(state.doc.toString()).toBe('first\n\nsecond')
  })

  it('keeps paragraph edge rhythm stable while an inserted soft line is still empty', () => {
    let state = EditorState.create({
      doc: 'first\nsecond',
      selection: EditorSelection.cursor(5),
      extensions: [markdown({ base: markdownLanguage }), editableBlankParagraph],
    })
    state = state.update({
      changes: { from: 5, insert: '\n' },
      selection: EditorSelection.cursor(6),
      annotations: Transaction.userEvent.of('input'),
    }).state

    const whileEmpty = decorations(state, 0, state.doc.length)
      .filter((item) => item.className?.startsWith('xmd-cm-paragraph'))
      .map(({ from, className }) => ({ from, className }))
    expect(whileEmpty).toEqual([
      { from: 0, className: 'xmd-cm-paragraph xmd-cm-paragraph-first' },
      { from: 6, className: 'xmd-cm-paragraph' },
      { from: 7, className: 'xmd-cm-paragraph xmd-cm-paragraph-last' },
    ])

    state = state.update({
      changes: { from: 6, insert: 'middle' },
      selection: EditorSelection.cursor(12),
      annotations: Transaction.userEvent.of('input'),
    }).state
    const afterTyping = decorations(state, 0, state.doc.length)
      .filter((item) => item.className?.startsWith('xmd-cm-paragraph'))
      .map(({ className }) => className)
    expect(afterTyping).toEqual([
      'xmd-cm-paragraph xmd-cm-paragraph-first',
      'xmd-cm-paragraph',
      'xmd-cm-paragraph xmd-cm-paragraph-last',
    ])
  })

  it('gives a new block paragraph its final spacing before text is entered', () => {
    let state = EditorState.create({
      doc: 'first\n',
      selection: EditorSelection.cursor(6),
      extensions: [markdown({ base: markdownLanguage }), editableBlankParagraph],
    })
    state = state.update({
      changes: { from: 6, insert: '\n' },
      selection: EditorSelection.cursor(7),
      annotations: Transaction.userEvent.of('input'),
    }).state

    expect(
      decorations(state, 0, state.doc.length)
        .filter((item) => item.className?.startsWith('xmd-cm-paragraph'))
        .map(({ from, className }) => ({ from, className })),
    ).toEqual([
      { from: 0, className: 'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last' },
      { from: 7, className: 'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last' },
    ])

    state = state.update({
      changes: { from: 7, insert: 'second' },
      selection: EditorSelection.cursor(13),
      annotations: Transaction.userEvent.of('input'),
    }).state
    expect(
      decorations(state, 0, state.doc.length)
        .filter((item) => item.className?.startsWith('xmd-cm-paragraph'))
        .map(({ className }) => className),
    ).toEqual([
      'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last',
      'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last',
    ])
  })

  it('does not modify source for a visual gap without an empty Markdown line', () => {
    const state = createState('## TypeScript\n```ts\nconst value = 1\n```', 13)
    const edit = visualGapEdit(state, state.doc.line(1).to)

    expect(edit).toBeNull()
  })

  it('reuses an existing empty source line instead of inserting another one', () => {
    const state = createState('## TypeScript\n\n```ts\ncode\n```', 13)

    expect(visualGapEdit(state, state.doc.line(1).to)).toEqual({ anchor: state.doc.line(2).from })
  })

  it('uses GFM nodes for strikethrough and task list preview', () => {
    const doc = '- [x] done\n\n~~removed~~'
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)

    expect(seen.some((item) => item.className === 'xmd-cm-strikethrough')).toBe(true)
    expect(seen.some((item) => item.replacement && item.to - item.from === 3)).toBe(true)
  })

  it('renders list markers from AST and hides the bullet before task checkboxes', () => {
    const doc = '- first\n  - nested\n1. ordered\n- [ ] task'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const listLines = seen.filter((item) => item.className === 'xmd-cm-list-line')
    const replacements = seen.filter((item) => item.replacement)

    expect(listLines).toHaveLength(4)
    expect(replacements.some(({ from, to }) => from === 0 && to === 2)).toBe(true)
    expect(replacements.some(({ from, to }) => from === 8 && to === 12)).toBe(true)
    expect(replacements.some(({ from, to }) => from === 19 && to === 22)).toBe(true)
    expect(replacements.some(({ from, to }) => from === 30 && to === 32)).toBe(true)
    expect(replacements.some(({ from, to }) => from === 32 && to === 35)).toBe(true)
  })

  it('makes complete list prefixes atomic while leaving item text editable', () => {
    const doc = '  - nested item'
    const state = createState(doc)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    expect(atomic).toContainEqual({ from: 0, to: 4 })
    expect(atomic.some(({ from, to }) => from <= 4 && to > 4)).toBe(false)
  })

  it('renders and protects list markers nested inside blockquotes', () => {
    const doc = '> - quoted\n>   > 1. deep'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    expect(seen.some(({ from, to }) => from === 2 && to === 4)).toBe(true)
    expect(seen.some(({ from, to }) => from === 17 && to === 20)).toBe(true)
    expect(atomic).toContainEqual({ from: 2, to: 4 })
    expect(atomic).toContainEqual({ from: 17, to: 20 })
  })

  it('hides quote delimiter whitespace and renders nested quote depth once per line', () => {
    const doc = '> outer\n> > inner'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    const quotes = seen.filter(({ className }) => className === 'xmd-cm-blockquote')
    expect(quotes).toHaveLength(2)
    expect(quotes.find(({ from }) => from === 8)?.style).toBe('--xmd-quote-depth:2')
    expect(atomic).toContainEqual({ from: 0, to: 2 })
    expect(atomic).toContainEqual({ from: 8, to: 10 })
    expect(atomic).toContainEqual({ from: 10, to: 12 })
  })

  it('adds safe href semantics to a visible link label', () => {
    const doc = '[visible](https://example.com) and [outside](../note.md)'
    const firstEnd = doc.indexOf(' and ')
    const state = createState(doc, firstEnd + 2)
    const seen = decorations(state, 0, firstEnd)

    expect(seen.find((item) => item.href)?.href).toBe('https://example.com')
    expect(seen.every((item) => item.from <= firstEnd)).toBe(true)
  })

  it('keeps link rendered and clickable while active', () => {
    const doc = '[label](../note.md)'
    const seen = decorations(createState(doc, 3), 0, doc.length)

    expect(seen.some((item) => item.href === '../note.md')).toBe(true)
    expect(seen.some((item) => item.replacement)).toBe(true)
  })

  it('hides the complete inline destination and optional title', () => {
    const doc = '[label](https://example.com "caption")'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const labelTo = doc.indexOf(']')

    expect(seen.some((item) => item.href === 'https://example.com')).toBe(true)
    expect(
      seen.some((item) => item.replacement && item.from === labelTo && item.to === doc.length),
    ).toBe(true)
  })

  it.each([
    ['[visible][target]', 'visible'],
    ['[target][]', 'target'],
    ['[target]', 'target'],
  ])('resolves %s and collapses its source-only reference definition', (link, label) => {
    const doc = `${link}\n\n[target]: ../other.md#section "title"`
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const referenceLine = state.doc.line(3)
    const atomic: Array<{ from: number; to: number }> = []
    buildHiddenMarkdownMarkerRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    }).between(0, doc.length, (from, to) => {
      atomic.push({ from, to })
    })

    expect(seen.some((item) => item.href === '../other.md#section')).toBe(true)
    expect(state.doc.sliceString(link.indexOf(label), link.indexOf(label) + label.length)).toBe(
      label,
    )
    expect(isBlockSeparatorLine(state, 3)).toBe(true)
    expect(
      seen.some(
        (item) => item.from === referenceLine.from && item.className === 'xmd-cm-block-separator',
      ),
    ).toBe(true)
    expect(atomic).toContainEqual({ from: referenceLine.from, to: referenceLine.to })
  })

  it('renders autolinks, bare web URLs and bare email addresses as safe links', () => {
    const doc = '<https://example.com> www.example.com user@example.com'
    const seen = decorations(createState(doc), 0, doc.length)

    expect(seen.filter((item) => item.href).map((item) => item.href)).toEqual([
      'https://example.com',
      'https://www.example.com',
      'mailto:user@example.com',
    ])
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
