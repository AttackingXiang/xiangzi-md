import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildLivePreviewDecorations,
  buildHiddenMarkdownMarkerSets,
  cleanupEmptyInlineHtml,
  inlineHtmlUnwrapDeletion,
  isSinglePhysicalLineSelection,
  safeMarkdownLinkHref,
  shouldUseNativeSelectionPainting,
} from './livePreview'

interface SeenDecoration {
  from: number
  to: number
  className?: string
  replacement: boolean
  href?: string
  editing?: string
  style?: string
  headingNumber?: string
  label?: string
}

function decorations(state: EditorState, from: number, to: number): SeenDecoration[] {
  const result: SeenDecoration[] = []
  buildLivePreviewDecorations(state, [{ from, to }], { viewportMargin: 0 }).between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo, value) => {
      const spec = value.spec as { class?: unknown; attributes?: Record<string, string> }
      const className = typeof spec.class === 'string' ? spec.class : undefined
      const widget = (spec as { widget?: { label?: unknown } }).widget
      result.push({
        from: rangeFrom,
        to: rangeTo,
        className,
        replacement: rangeTo > rangeFrom && className === undefined,
        href: spec.attributes?.['data-xmd-href'],
        editing: spec.attributes?.['data-xmd-editing'],
        style: spec.attributes?.style,
        headingNumber: spec.attributes?.['data-xmd-heading-number'],
        label: typeof widget?.label === 'string' ? widget.label : undefined,
      })
    },
  )
  return result
}

function hiddenRanges(state: EditorState, from: number, to: number): PreviewRangeLike[] {
  const result: PreviewRangeLike[] = []
  buildHiddenMarkdownMarkerSets(state, [{ from, to }], { viewportMargin: 0 }).atomic.between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo) => {
      result.push({ from: rangeFrom, to: rangeTo })
    },
  )
  return result
}

function hiddenDecorations(state: EditorState, from: number, to: number): SeenDecoration[] {
  const result: SeenDecoration[] = []
  buildHiddenMarkdownMarkerSets(state, [{ from, to }], { viewportMargin: 0 }).decorations.between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo, value) => {
      const spec = value.spec as { class?: string; attributes?: Record<string, string> }
      result.push({
        from: rangeFrom,
        to: rangeTo,
        className: spec.class,
        replacement: rangeTo > rangeFrom && spec.class === undefined,
        style: spec.attributes?.style,
      })
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

describe('CM6 Markdown live preview: selection presentation', () => {
  it('uses native painting only for one non-empty physical-line selection', () => {
    const doc = '> quoted\nplain'
    const sameLine = createState(doc).update({
      selection: EditorSelection.range(0, doc.indexOf('\n')),
    }).state
    const crossLine = createState(doc).update({
      selection: EditorSelection.range(0, doc.length),
    }).state
    const multiple = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(doc.indexOf('plain'), doc.length),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })

    expect(isSinglePhysicalLineSelection(sameLine)).toBe(true)
    expect(isSinglePhysicalLineSelection(crossLine)).toBe(false)
    expect(isSinglePhysicalLineSelection(createState(doc))).toBe(false)
    expect(isSinglePhysicalLineSelection(multiple)).toBe(false)
  })

  it('uses native painting for a fully mounted cross-line Tauri selection', () => {
    const doc = 'before\n\n---\n\n## heading\nafter'
    const headingEnd = doc.indexOf('\nafter')
    const crossLine = createState(doc).update({
      selection: EditorSelection.range('before'.length, headingEnd),
    }).state

    expect(
      shouldUseNativeSelectionPainting(
        crossLine,
        [
          { from: 0, to: doc.indexOf('---') },
          { from: doc.indexOf('##'), to: doc.length },
        ],
        true,
      ),
    ).toBe(true)
    expect(
      shouldUseNativeSelectionPainting(crossLine, [{ from: headingEnd, to: doc.length }], true),
    ).toBe(false)
    expect(shouldUseNativeSelectionPainting(crossLine, [{ from: 0, to: doc.length }], false)).toBe(
      false,
    )
  })
})

describe('CM6 Markdown live preview: heading rendering', () => {
  it('assigns stable hierarchical numbers from the complete document', () => {
    const doc = '# One\n\n### Deep\n\n## Two\n\n# Next\n\n## Child'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const numbered = seen
      .filter(({ headingNumber }) => headingNumber)
      .map(({ from, headingNumber }) => ({ from, headingNumber }))

    expect(numbered).toEqual([
      { from: 0, headingNumber: '1' },
      { from: doc.indexOf('### Deep'), headingNumber: '1.0.1' },
      { from: doc.indexOf('## Two'), headingNumber: '1.1' },
      { from: doc.indexOf('# Next'), headingNumber: '2' },
      { from: doc.indexOf('## Child'), headingNumber: '2.1' },
    ])
  })

  it('keeps numbering stable when only a later viewport is mounted', () => {
    const doc = '# One\n\n## Hidden child\n\n## Visible child'
    const state = createState(doc)
    const visibleFrom = doc.indexOf('## Visible child')
    const seen = decorations(state, visibleFrom, doc.length)

    expect(seen).toContainEqual(
      expect.objectContaining({ from: visibleFrom, headingNumber: '1.2' }),
    )
  })

  it('keeps an ATX opening prefix as collapsed source text while retaining atomic boundaries', () => {
    const doc = '  ### Heading ###'
    const state = createState(doc, doc.length)
    const atomic = hiddenRanges(state, 0, doc.length)
    const paint = hiddenDecorations(state, 0, doc.length)

    expect(atomic).toContainEqual({ from: 2, to: 6 })
    expect(paint).toContainEqual(
      expect.objectContaining({
        from: 2,
        to: 6,
        className: 'xmd-cm-preserved-hidden-source',
        replacement: false,
      }),
    )
    // Closing ATX markers do not sit on the unstable visual line-start
    // boundary, so they keep the ordinary replacement presentation.
    expect(paint).toContainEqual(expect.objectContaining({ from: 14, to: 17, replacement: true }))
  })

  it('preserves nested quote, heading, and emphasis prefixes through the shared line-leading policy', () => {
    const doc = '> # **quoted heading**\n\nplain'
    const state = createState(doc, doc.indexOf('plain'))
    const paint = hiddenDecorations(state, 0, doc.length)

    expect(paint).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 0,
          to: 2,
          className: 'xmd-cm-preserved-hidden-source',
          replacement: false,
        }),
        expect.objectContaining({
          from: 2,
          to: 4,
          className: 'xmd-cm-preserved-hidden-source',
          replacement: false,
        }),
        expect.objectContaining({
          from: 4,
          to: 6,
          className: 'xmd-cm-preserved-hidden-source',
          replacement: false,
        }),
      ]),
    )
  })

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
    expect(
      hiddenDecorations(state, 0, doc.length).some(
        ({ from, to, replacement }) =>
          from === underlineLine.from && to === underlineLine.to && replacement,
      ),
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
  it('preserves a hidden inline marker when it is the visual line prefix', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, doc.indexOf('plain'))
    const paint = hiddenDecorations(state, 0, doc.length)

    expect(paint).toContainEqual(
      expect.objectContaining({
        from: 0,
        to: 2,
        className: 'xmd-cm-preserved-hidden-source',
        replacement: false,
      }),
    )
    expect(paint).toContainEqual(expect.objectContaining({ from: 6, to: 8, replacement: true }))
  })

  it('hides strong markers while the selection sits outside the construct, keeping the rendered style', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(2)
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('reveals the marker characters the instant the caret enters the construct', () => {
    const doc = '**bold** and plain'
    const state = createState(doc, 4) // inside "bold"
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(0)
    // The construct still renders bold while its markers are visible.
    expect(seen.some((item) => item.className === 'xmd-cm-strong')).toBe(true)
  })

  it('keeps markers hidden while a non-empty selection crosses formatted text', () => {
    const doc = 'before **bold** after'
    const from = doc.indexOf('bold')
    const state = createState(doc, from).update({
      selection: EditorSelection.range(from, from + 'bold'.length),
    }).state
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(hidden.filter((item) => item.to - item.from === 2)).toHaveLength(2)
  })

  it('hides again once the caret leaves the construct', () => {
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

describe('CM6 Markdown live preview: safe inline HTML formatting', () => {
  it('renders font color and hides its source tags while the caret is outside', () => {
    const doc = '<font color="#ff00ff">magenta</font> and plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)
    const openingEnd = doc.indexOf('>') + 1
    const closingStart = doc.indexOf('</font>')

    expect(seen).toContainEqual(
      expect.objectContaining({
        from: openingEnd,
        to: closingStart,
        className: 'xmd-cm-inline-color',
        style: 'color:#ff00ff',
      }),
    )
    expect(hidden).toContainEqual({ from: 0, to: openingEnd })
    expect(hidden).toContainEqual({ from: closingStart, to: closingStart + 7 })
  })

  it('renders standard and colored mark highlights while hiding their source tags', () => {
    const doc = '<mark>default</mark> and <mark style="background-color:#93c5fd">blue</mark> plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)
    const defaultFrom = doc.indexOf('default')
    const blueFrom = doc.indexOf('blue')

    expect(seen).toContainEqual(
      expect.objectContaining({
        from: defaultFrom,
        to: defaultFrom + 'default'.length,
        className: 'xmd-cm-inline-highlight',
      }),
    )
    expect(seen).toContainEqual(
      expect.objectContaining({
        from: blueFrom,
        to: blueFrom + 'blue'.length,
        className: 'xmd-cm-inline-highlight',
        style: 'background-color:#93c5fd',
      }),
    )
    expect(hidden).toContainEqual({ from: 0, to: '<mark>'.length })
    expect(hidden).toContainEqual({
      from: doc.indexOf('</mark>'),
      to: doc.indexOf('</mark>') + '</mark>'.length,
    })
  })

  it('leaves unsafe mark styles visible instead of applying arbitrary CSS', () => {
    const doc = '<mark style="background-color:red;display:none">unsafe</mark> plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(seen.some(({ className }) => className === 'xmd-cm-inline-highlight')).toBe(false)
    expect(hidden.some(({ from }) => doc.slice(from).startsWith('<mark'))).toBe(false)
  })

  it('keeps both tags hidden with the caret inside the colored text, and still paints the color', () => {
    // Inline HTML tags never reveal: `<font color="#ff0000">` is 22 characters,
    // so revealing it (the old `**bold**`-style behaviour) reflowed the line
    // into markup as soon as the caret entered the text to edit it. Deleting
    // the wrapper is handled by `inlineHtmlUnwrapDeletion` instead.
    const doc = '<font color="#ff0000">notice</font>'
    const cursor = doc.indexOf('notice') + 2
    const state = createState(doc, cursor)
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)
    const openingEnd = doc.indexOf('>') + 1
    const closingStart = doc.indexOf('</font>')

    expect(
      seen.some(
        ({ className, style }) => className === 'xmd-cm-inline-color' && style === 'color:#ff0000',
      ),
    ).toBe(true)
    expect(hidden).toContainEqual({ from: 0, to: openingEnd })
    expect(hidden).toContainEqual({ from: closingStart, to: doc.length })
  })

  it('keeps the tag pair hidden at every caret position, including both atomic boundaries', () => {
    const doc = '- <font color="#ff0000">a long colored list item</font>'
    const openingFrom = doc.indexOf('<font')
    const openingTo = doc.indexOf('>') + 1
    const closingFrom = doc.indexOf('</font>')
    const closingTo = closingFrom + '</font>'.length

    // Outside the span, inside the text, and resting on either atomic
    // boundary — the positions a real Backspace/Delete probe lands on.
    for (const cursor of [0, openingFrom, openingFrom + 5, closingTo]) {
      const hidden = hiddenRanges(createState(doc, cursor), 0, doc.length)
      expect(hidden).toContainEqual({ from: openingFrom, to: openingTo })
      expect(hidden).toContainEqual({ from: closingFrom, to: closingTo })
    }

    // A non-empty selection over the colored text behaves the same.
    const selected = createState(doc, openingTo).update({
      selection: EditorSelection.range(openingTo, closingFrom),
    }).state
    const hidden = hiddenRanges(selected, 0, doc.length)
    expect(hidden).toContainEqual({ from: openingFrom, to: openingTo })
    expect(hidden).toContainEqual({ from: closingFrom, to: closingTo })
  })

  describe('cleanupEmptyInlineHtml', () => {
    // 删光彩色文字后，空的 <font></font> 会留在源码里。标签是隐藏的，用户看不见
    // 它，下一次在那儿打字还会继承颜色——所以删空即拆掉包裹。
    const cleaned = (
      doc: string,
      change: { from: number; to: number; insert?: string },
    ): string => {
      const state = createState(doc, 0)
      const transaction = state.update({ changes: change, userEvent: 'delete.selection' })
      const spec = cleanupEmptyInlineHtml(transaction)
      if (!spec) return transaction.state.doc.toString()
      return transaction.state.update(spec).state.doc.toString()
    }

    it('removes a color wrapper whose text was deleted', () => {
      const doc = '前缀<font color="#ff0000">红字</font>后缀'
      const from = doc.indexOf('红字')
      expect(cleaned(doc, { from, to: from + '红字'.length })).toBe('前缀后缀')
    })

    it('removes an emptied highlight wrapper too', () => {
      const doc = '<mark style="background-color:#fde047">marked</mark> tail'
      const from = doc.indexOf('marked')
      expect(cleaned(doc, { from, to: from + 'marked'.length })).toBe(' tail')
    })

    it('keeps a wrapper that still has text in it', () => {
      const doc = '前缀<font color="#ff0000">红字</font>后缀'
      const from = doc.indexOf('红字')
      expect(cleaned(doc, { from, to: from + 1 })).toBe('前缀<font color="#ff0000">字</font>后缀')
    })

    it('leaves wrappers on untouched lines alone', () => {
      const doc = '<font color="#ff0000"></font>\n第二行'
      const second = doc.indexOf('第二行')
      // 只改第二行时不去动第一行遗留的空包裹：这一趟清理只负责本次编辑的后果。
      expect(cleaned(doc, { from: second, to: second + 1 })).toBe(
        '<font color="#ff0000"></font>\n二行',
      )
    })
  })

  describe('inlineHtmlUnwrapDeletion', () => {
    // 光标停在包裹边界时，退格/删除去掉整对标签、保留文字——标签既然永远不显形，
    // "删掉一个字符的标记"就没有意义了，能删的只有整个包裹。
    const doc = '前缀<font color="#ff0000">红字</font>后缀'
    const openingFrom = doc.indexOf('<font')
    const openingTo = doc.indexOf('>') + 1
    const closingFrom = doc.indexOf('</font>')
    const closingTo = closingFrom + '</font>'.length
    const unwrapped = '前缀红字后缀'

    const applied = (cursor: number, forward: boolean): { doc: string; head: number } | null => {
      const state = createState(doc, cursor)
      const spec = inlineHtmlUnwrapDeletion(state, forward)
      if (!spec) return null
      const next = state.update(spec).state
      return { doc: next.doc.toString(), head: next.selection.main.head }
    }

    it('removes the wrapper on Backspace after the closing tag', () => {
      expect(applied(closingTo, false)).toEqual({
        doc: unwrapped,
        head: unwrapped.indexOf('后缀'),
      })
    })

    it('removes the wrapper on Backspace at the start of the colored text', () => {
      expect(applied(openingTo, false)).toEqual({
        doc: unwrapped,
        head: unwrapped.indexOf('红字'),
      })
    })

    it('removes the wrapper on Delete before the opening tag and before the closing tag', () => {
      expect(applied(openingFrom, true)).toEqual({
        doc: unwrapped,
        head: unwrapped.indexOf('红字'),
      })
      expect(applied(closingFrom, true)).toEqual({
        doc: unwrapped,
        head: unwrapped.indexOf('后缀'),
      })
    })

    it('leaves ordinary positions to the default deletion commands', () => {
      expect(applied(0, false)).toBeNull()
      expect(applied(openingTo + 1, false)).toBeNull()
      expect(applied(doc.length, true)).toBeNull()
      // Backspace looks left, Delete looks right — a boundary only answers to
      // the direction that actually points at the wrapper.
      expect(applied(closingTo, true)).toBeNull()
      expect(applied(openingFrom, false)).toBeNull()
    })
  })

  it('never hides a range that crosses a newline, even when a tag itself spans multiple lines', () => {
    // core/README.md invariant 2: a hidden range must never cross a
    // newline. A pathological multi-line `<font\ncolor="red">` tag must be
    // skipped rather than registered as a (cross-line) hidden range.
    const doc = '<font\ncolor="red">multiline</font> after'
    const state = createState(doc, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    for (const { from, to } of hidden) {
      expect(state.doc.lineAt(from).number).toBe(state.doc.lineAt(Math.max(from, to - 1)).number)
    }
  })

  it('renders nested HTML bold tags inside a colored span', () => {
    const doc = '<font color=magenta>path/<b>tomcat_version</b>/app</font> plain'
    const state = createState(doc, doc.indexOf('plain'))
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)
    const boldFrom = doc.indexOf('<b>') + 3
    const boldTo = doc.indexOf('</b>')

    expect(seen).toContainEqual(
      expect.objectContaining({
        from: boldFrom,
        to: boldTo,
        className: 'xmd-cm-strong',
      }),
    )
    expect(
      seen.some(
        ({ className, style }) => className === 'xmd-cm-inline-color' && style === 'color:magenta',
      ),
    ).toBe(true)
    expect(hidden).toContainEqual({ from: boldFrom - 3, to: boldFrom })
    expect(hidden).toContainEqual({ from: boldTo, to: boldTo + 4 })
  })

  it('leaves unsafe, malformed and code-literal tags visible', () => {
    const doc = [
      '<font color="red;display:none">unsafe</font>',
      '<font color="#ff0000">unclosed',
      '`<font color="#ff0000">code</font>`',
      '```html',
      '<font color="#ff0000">block code</font>',
      '```',
    ].join('\n')
    const state = createState(doc, doc.length)
    const seen = decorations(state, 0, doc.length)
    const hidden = hiddenRanges(state, 0, doc.length)

    expect(seen.some(({ className }) => className === 'xmd-cm-inline-color')).toBe(false)
    expect(hidden.some(({ from }) => doc.slice(from).startsWith('<font'))).toBe(false)
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

  it('renders Obsidian callout kinds and aliases while leaving unknown kinds editable', () => {
    const cases = [
      ['ABSTRACT', 'abstract'],
      ['SUMMARY', 'abstract'],
      ['INFO', 'info'],
      ['TODO', 'todo'],
      ['HINT', 'tip'],
      ['SUCCESS', 'success'],
      ['FAQ', 'question'],
      ['ATTENTION', 'warning'],
      ['FAIL', 'failure'],
      ['ERROR', 'danger'],
      ['BUG', 'bug'],
      ['EXAMPLE', 'example'],
      ['CITE', 'quote'],
    ] as const
    const doc = [...cases.map(([label]) => `> [!${label}]`), '> [!CUSTOM]'].join('\n')
    const seen = decorations(createState(doc), 0, doc.length)

    for (const [label, kind] of cases) {
      const markerStart = doc.indexOf(`[!${label}]`)
      expect(
        seen.some(
          (item) =>
            item.className === `xmd-cm-callout xmd-cm-callout-${kind}` &&
            item.from === doc.lastIndexOf('> ', markerStart),
        ),
      ).toBe(true)
      expect(
        seen.some(
          (item) =>
            item.replacement &&
            item.from === markerStart &&
            item.to === markerStart + label.length + 3,
        ),
      ).toBe(true)
    }

    const unknownStart = doc.indexOf('[!CUSTOM]')
    expect(seen.some((item) => item.replacement && item.from === unknownStart)).toBe(false)
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
  it('renumbers visible ordered-list markers after an item is removed', () => {
    const doc = '1. first\n3. third\n   7. nested\n   9. nested later\n4. fourth'
    const state = createState(doc)
    const labels = decorations(state, 0, doc.length)
      .filter(({ label }) => label)
      .map(({ from, label }) => ({ from, label }))

    expect(labels).toEqual([
      { from: 0, label: '1.' },
      { from: doc.indexOf('3. third'), label: '2.' },
      { from: doc.indexOf('   7. nested'), label: '7.' },
      { from: doc.indexOf('   9. nested later'), label: '8.' },
      { from: doc.indexOf('4. fourth'), label: '3.' },
    ])
  })

  it('renders list markers from AST and hides the bullet before task checkboxes', () => {
    const doc = '- first\n  - nested\n1. ordered\n- [ ] task'
    const state = createState(doc)
    const seen = decorations(state, 0, doc.length)
    const listLines = seen.filter((item) => item.className === 'xmd-cm-list-line')
    const replacements = seen.filter((item) => item.replacement)

    expect(listLines).toHaveLength(4)
    expect(listLines.map(({ style }) => style)).toEqual([
      '--xmd-list-hang:1.75em',
      '--xmd-list-hang:3.1em',
      '--xmd-list-hang:1.75em',
      '--xmd-list-hang:1.36em',
    ])
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

  it('hides the bracket/destination syntax while the caret is outside the link', () => {
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

  it('reveals the full raw link syntax once the caret enters it', () => {
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

describe('CM6 Markdown live preview: compact blank lines', () => {
  const blankLines = (doc: string): number[] =>
    decorations(createState(doc), 0, doc.length)
      .filter((item) => item.className === 'xmd-cm-blank-line')
      .map((item) => item.from)

  it('marks the single blank line that separates two blocks', () => {
    const doc = 'first\n\nsecond'

    expect(blankLines(doc)).toEqual([doc.indexOf('first') + 'first\n'.length])
  })

  it('marks only the first row of a run so deliberate whitespace keeps its height', () => {
    const doc = 'first\n\n\n\nsecond'

    expect(blankLines(doc)).toEqual(['first\n'.length])
  })

  it('leaves blank lines inside fenced and indented code blocks alone', () => {
    const fenced = '```js\nconst a = 1\n\nconst b = 2\n```'
    const indented = 'para\n\n    const a = 1\n\n    const b = 2'

    expect(blankLines(fenced)).toEqual([])
    // Only the separator between the paragraph and the code block qualifies;
    // the blank row *inside* the indented block is code content.
    expect(blankLines(indented)).toEqual(['para\n'.length])
  })

  it('never marks a blank line as replaced or hidden', () => {
    const doc = 'first\n\nsecond'
    const blankFrom = 'first\n'.length

    expect(decorations(createState(doc), 0, doc.length)).toContainEqual(
      expect.objectContaining({ from: blankFrom, to: blankFrom, replacement: false }),
    )
    expect(hiddenRanges(createState(doc), 0, doc.length)).toEqual([])
  })
})
