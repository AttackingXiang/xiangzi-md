import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildLivePreviewDecorations,
  buildHiddenMarkdownMarkerRanges,
  safeMarkdownLinkHref,
} from './livePreview'

interface SeenDecoration {
  from: number
  to: number
  className?: string
  replacement: boolean
  href?: string
  editing?: string
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
        editing: spec.attributes?.['data-xmd-editing'],
        style: spec.attributes?.style,
      })
    },
  )
  return result
}

function hiddenRanges(state: EditorState, from: number, to: number): PreviewRangeLike[] {
  const result: PreviewRangeLike[] = []
  buildHiddenMarkdownMarkerRanges(state, [{ from, to }], { viewportMargin: 0 }).between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo) => {
      result.push({ from: rangeFrom, to: rangeTo })
    },
  )
  return result
}

interface PreviewRangeLike {
  from: number
  to: number
}

function createState(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  })
}

describe('CM6 Markdown live preview: heading rendering', () => {
  it('renders Setext headings as one visual row and hides their underline as an ordinary blank-looking line', () => {
    const doc = 'Heading\n======='
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(seen.some(({ from, className }) => from === 0 && className?.includes('heading-1'))).toBe(
      true,
    )
    // The underline row is hidden entirely (its own line, never crossing the
    // newline that separates it from the heading text line above).
    const underlineLine = state.doc.line(2)
    expect(
      hidden.some(({ from, to }) => from === underlineLine.from && to === underlineLine.to),
    ).toBe(true)
  })

  it('keeps heading decoration after deleting the blank line below it', () => {
    const initial = createState('# Title\n\nparagraph', 8)
    const state = initial.update({ changes: { from: 8, to: 9 } }).state
    const seen = decorations(state, 0, state.doc.line(1).to)
    const hidden = hiddenRanges(state, 0, state.doc.line(1).to)

    expect(state.doc.toString()).toBe('# Title\nparagraph')
    expect(seen.some((item) => item.className === 'xmd-cm-heading xmd-cm-heading-1')).toBe(true)
    expect(hidden.some((item) => item.from === 0 && item.to === 2)).toBe(true)
  })

  it('only decorates syntax inside the requested viewport', () => {
    const doc = '# Visible\n\n' + 'plain\n'.repeat(80) + '# Outside'
    const state = createState(doc, doc.indexOf('plain'))
    const firstLineEnd = doc.indexOf('\n')
    const seen = decorations(state, 0, firstLineEnd)

    expect(seen.some((item) => item.className === 'xmd-cm-heading xmd-cm-heading-1')).toBe(true)
    expect(seen.every((item) => item.from <= firstLineEnd)).toBe(true)
  })
})

describe('CM6 Markdown live preview: reveal-on-selection inline marks', () => {
  it('hides strong markers while the selection sits outside the construct, keeping the rendered style', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(2)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('reveals the marker characters the instant the selection enters the construct', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, 4) // inside "bold"
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(0)
    // The construct still renders bold while its markers are visible.
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('hides again once the selection leaves the construct', () => {
    const doc = '**bold** and plain'
    const revealed = hiddenRanges(createState(doc, 4), 0, doc.length)
    const hidden = hiddenRanges(createState(doc, doc.indexOf('plain')), 0, doc.length)

    expect(revealed.filter((item) => item.to - item.from === 2)).toHaveLength(0)
    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(2)
  })

  it('makes every hidden Markdown marker atomic without locking rendered content', () => {
    const doc = '# **bold** and *italic* with [link](https://example.com)'
    const state = createState(doc, 0)
    const atomic = hiddenRanges(state, 0, doc.length)

    expect(atomic).toContainEqual({ from: 0, to: 2 })
    expect(atomic).toContainEqual({ from: 2, to: 4 })
    expect(atomic).toContainEqual({ from: 8, to: 10 })
    expect(atomic.some(({ from, to }) => from <= 4 && to >= 8)).toBe(false)
    expect(atomic.every(({ from, to }) => to > from)).toBe(true)
  })

  it('uses GFM nodes for strikethrough and task list preview', () => {
    const doc = '- [x] done\n\n~~removed~~'
    const state = createState(doc, 0)
    const seen = decorations(state, 0, doc.length)

    expect(seen.some((item) => item.className === 'xmd-cm-strikethrough')).toBe(true)
    expect(seen.some((item) => item.replacement && item.to - item.from === 3)).toBe(true)
  })
})

describe('CM6 Markdown live preview: paragraphs, callouts and thematic breaks', () => {
  it('renders document paragraphs without applying paragraph layout to lists or quotes', () => {
    const doc = 'first line\ncontinued\n\n- list item\n\n> quoted'
    const seen = decorations(createState(doc), 0, doc.length)
    const paragraphLines = seen.filter((item) => item.className?.startsWith('xmd-cm-paragraph'))

    expect(paragraphLines.map(({ from, className }) => ({ from, className }))).toEqual([
      { from: 0, className: 'xmd-cm-paragraph xmd-cm-paragraph-first' },
      {
        from: doc.indexOf('continued'),
        className: 'xmd-cm-paragraph xmd-cm-paragraph-last xmd-cm-paragraph-gap-after',
      },
    ])
  })

  it('renders GitHub-style quote alerts as labelled callouts without exposing the marker', () => {
    const doc = '> [!WARNING]\n> Read this first.'
    const seen = decorations(createState(doc), 0, doc.length)
    expect(seen.some((item) => item.className === 'xmd-cm-callout xmd-cm-callout-warning')).toBe(
      true,
    )
    const markerStart = doc.indexOf('[!WARNING]')
    expect(
      seen.some(
        (item) => item.replacement && item.from === markerStart && item.to === markerStart + 10,
      ),
    ).toBe(true)
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
    const atomic = hiddenRanges(state, 0, doc.length)

    expect(atomic).toEqual([{ from: doc.indexOf('***'), to: doc.indexOf('***') + 3 }])
  })
})

describe('CM6 Markdown live preview: lists and quotes', () => {
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
    const atomic = hiddenRanges(state, 0, doc.length)

    expect(atomic).toContainEqual({ from: 0, to: 4 })
    expect(atomic.some(({ from, to }) => from <= 4 && to > 4)).toBe(false)
  })

  it('renders and protects list markers nested inside blockquotes', () => {
    const doc = '> - quoted\n>   > 1. deep'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const atomic = hiddenRanges(state, 0, doc.length)

    expect(seen.some(({ from, to }) => from === 2 && to === 4)).toBe(true)
    expect(seen.some(({ from, to }) => from === 17 && to === 20)).toBe(true)
    expect(atomic).toContainEqual({ from: 2, to: 4 })
    expect(atomic).toContainEqual({ from: 17, to: 20 })
  })

  it('hides quote delimiter whitespace and renders nested quote depth once per line, regardless of selection', () => {
    const doc = '> outer\n> > inner'
    const state = createState(doc, doc.indexOf('inner'))
    const seen = decorations(state, 0, doc.length)
    const atomic = hiddenRanges(state, 0, doc.length)

    const quotes = seen.filter(({ className }) => className === 'xmd-cm-blockquote')
    expect(quotes).toHaveLength(2)
    expect(quotes.find(({ from }) => from === 8)?.style).toBe('--xmd-quote-depth:2')
    expect(atomic).toContainEqual({ from: 0, to: 2 })
    expect(atomic).toContainEqual({ from: 8, to: 10 })
    expect(atomic).toContainEqual({ from: 10, to: 12 })
  })
})

describe('CM6 Markdown live preview: links', () => {
  it('adds safe href semantics to a visible link label', () => {
    const doc = '[visible](https://example.com) and [outside](../note.md)'
    const firstEnd = doc.indexOf(' and ')
    const state = createState(doc, firstEnd + 2)
    const seen = decorations(state, 0, firstEnd)

    expect(seen.find((item) => item.href)?.href).toBe('https://example.com')
    expect(seen.every((item) => item.from <= firstEnd)).toBe(true)
  })

  it('hides the bracket/destination syntax while the selection is outside the link', () => {
    const doc = 'before [label](https://example.com "caption") after'
    const linkTo = doc.indexOf(' after')
    const state = createState(doc, 0)
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)
    const labelTo = doc.indexOf(']')

    expect(seen.some((item) => item.href === 'https://example.com')).toBe(true)
    expect(seen.find((item) => item.href)?.editing).toBe('false')
    expect(hidden.some((item) => item.from === labelTo && item.to === linkTo)).toBe(true)
  })

  it('reveals the full raw link syntax once the selection enters it', () => {
    const doc = 'before [label](https://example.com) after'
    const linkFrom = doc.indexOf('[label]')
    const state = createState(doc, linkFrom + 3) // inside "label"
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden).toHaveLength(0)
    expect(seen.find((item) => item.href)?.editing).toBe('true')
  })

  it.each([
    ['[visible][target]', 'visible'],
    ['[target][]', 'target'],
    ['[target]', 'target'],
  ])('resolves %s and collapses its source-only reference definition', (link, label) => {
    const doc = `${link}\n\n[target]: ../other.md#section "title"`
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)
    const referenceLine = state.doc.line(3)
    const atomic = hiddenRanges(state, 0, doc.length)

    expect(seen.some((item) => item.href === '../other.md#section')).toBe(true)
    expect(state.doc.sliceString(link.indexOf(label), link.indexOf(label) + label.length)).toBe(
      label,
    )
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

describe('CM6 Markdown live preview: the blank-line model', () => {
  it('never produces a hidden/replace decoration that crosses a newline', () => {
    const doc = '# Title\n\nfirst\n\n\nsecond\n\n> quote\n\nend'
    const state = createState(doc)
    const paint = decorations(state, 0, doc.length).filter((item) => item.replacement)
    const hidden = hiddenRanges(state, 0, doc.length)

    for (const { from, to } of [...paint, ...hidden]) {
      expect(state.doc.sliceString(from, to)).not.toContain('\n')
    }
  })

  it('never hides or replaces content on a blank source line — every blank line stays addressable', () => {
    const doc = 'first\n\n\nsecond\n\n\n\nthird'
    const state = createState(doc)
    const paint = decorations(state, 0, doc.length).filter((item) => item.replacement)
    const hidden = hiddenRanges(state, 0, doc.length)

    for (let number = 1; number <= state.doc.lines; number += 1) {
      const line = state.doc.line(number)
      if (line.length !== 0) continue
      const touchesThisBlankLine = [...paint, ...hidden].some(
        (range) => range.to > range.from && range.from <= line.from && range.to >= line.from,
      )
      expect(touchesThisBlankLine).toBe(false)
    }
  })

  it('gives every paragraph line — including ones separated by multiple blank lines — its own edge classes', () => {
    const doc = 'first\n\n\nsecond'
    const seen = decorations(createState(doc), 0, doc.length)
    const paragraphLines = seen.filter((item) => item.className?.startsWith('xmd-cm-paragraph'))

    expect(paragraphLines.map(({ from, className }) => ({ from, className }))).toEqual([
      {
        from: 0,
        className:
          'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last xmd-cm-paragraph-gap-after',
      },
      {
        from: doc.indexOf('second'),
        className:
          'xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last xmd-cm-paragraph-gap-before',
      },
    ])
  })
})
