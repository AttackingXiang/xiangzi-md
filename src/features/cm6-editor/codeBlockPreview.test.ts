import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildCodeBlockPreviewDecorations,
  codeBlockOverlayHorizontalGeometry,
  codeControlsTop,
  codeLanguageOptions,
  collectFencedCodeHiddenRanges,
  fencedCodeBoundaryDeletion,
  fencedCodeFenceRedirectTarget,
  fencedCodeLineBoundary,
  fencedCodeSelectAll,
  matchingCodeLanguageOptions,
  needsCodeCaretRepaint,
  partiallyDeletesFencedCodeFence,
  pinnedOverlayTop,
  readFencedCode,
  resolveCodeLanguageInput,
  restoreEmptyFencedCodeBody,
  selectionIntersectsFencedCode,
  type OverlayPinGeometry,
} from './codeBlockPreview'

function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  })
}

function decorations(
  state: EditorState,
  from: number,
  to: number,
): Array<[number, number, string]> {
  const ranges: Array<[number, number, string]> = []
  buildCodeBlockPreviewDecorations(state, [{ from, to }], { viewportMargin: 0 }).between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo, value) => {
      const spec = value.spec as { class?: string }
      // Content marks keep CodeText editable; this helper only tracks the
      // structural replace/widget decorations used by the assertions below.
      if (spec.class === 'xmd-cm-code-line-content') return
      ranges.push([rangeFrom, rangeTo, ''])
    },
  )
  return ranges
}

function codeLineClasses(
  state: EditorState,
  options: { lineWrapping?: boolean } = {},
): Map<number, string> {
  const classes = new Map<number, string>()
  buildCodeBlockPreviewDecorations(state, [{ from: 0, to: state.doc.length }], {
    viewportMargin: 0,
    ...options,
  }).between(0, state.doc.length, (from, to, value) => {
    const spec: unknown = value.spec
    if (from !== to || typeof spec !== 'object' || spec === null || !('class' in spec)) return
    const className = (spec as Record<string, unknown>).class
    if (typeof className === 'string' && className.includes('xmd-cm-code-line')) {
      classes.set(from, className)
    }
  })
  return classes
}

function insertEnter(state: EditorState, position: number): EditorState {
  return state.update({
    changes: { from: position, insert: '\n' },
    selection: EditorSelection.cursor(position + 1),
    userEvent: 'input.type',
  }).state
}

function fencedCodeCount(state: EditorState): number {
  let count = 0
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode') count += 1
    },
  })
  return count
}

describe('CM6 fenced code preview', () => {
  it('provides unique CM6 language suggestions for the editable language input', () => {
    expect(codeLanguageOptions[0]).toEqual({ label: 'Text', value: '' })
    expect(codeLanguageOptions.some((entry) => entry.value === 'javascript')).toBe(true)
    expect(new Set(codeLanguageOptions.map((entry) => entry.value)).size).toBe(
      codeLanguageOptions.length,
    )
  })

  it('resolves typed language prefixes while preserving custom language names', () => {
    expect(resolveCodeLanguageInput('py')).toBe('python')
    expect(resolveCodeLanguageInput('JS')).toBe('javascript')
    expect(resolveCodeLanguageInput('java')).toBe('java')
    expect(resolveCodeLanguageInput('text')).toBe('')
    expect(resolveCodeLanguageInput('my-custom-language')).toBe('my-custom-language')
  })

  it('shows complete prefix and alias matches in the custom language menu', () => {
    expect(matchingCodeLanguageOptions('py').map((entry) => entry.value)).toEqual(['python'])
    expect(matchingCodeLanguageOptions('pyt')[0]).toEqual({ label: 'Python', value: 'python' })
    expect(matchingCodeLanguageOptions('js')[0]?.value).toBe('javascript')
  })

  it('only hides fence text and never replaces CodeText', () => {
    const doc = '```ts\nconst answer = 42\n```\n\nafter'
    const state = stateAt(doc, doc.length)
    const codeFrom = doc.indexOf('const')
    const codeTo = codeFrom + 'const answer = 42'.length
    const ranges = decorations(state, 0, doc.indexOf('\n\nafter'))
    expect(ranges.some(([from, to]) => from <= codeFrom && to >= codeTo)).toBe(false)
    expect(ranges.some(([from, to]) => from === 0 && to === 5)).toBe(true)
  })

  it('keeps code content in the outer document when the cursor touches it', () => {
    const doc = '```ts\nconst answer = 42\n```'
    const state = stateAt(doc, doc.indexOf('answer'))
    const ranges = decorations(state, 0, doc.length)
    expect(
      ranges.some(([from, to]) => from < doc.indexOf('answer') && to > doc.indexOf('answer')),
    ).toBe(false)
  })

  it('keeps first and last code lines visually decorated while hidden ranges only cover fences', () => {
    const doc = '```ts\nfirst()\nlast()\n```\nafter'
    const state = stateAt(doc, doc.indexOf('first'))
    const visual = buildCodeBlockPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    })
    const hidden = collectFencedCodeHiddenRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    })
    const firstFrom = doc.indexOf('first')
    const lastFrom = doc.indexOf('last')
    const visualPoints: number[] = []
    visual.between(0, doc.length, (from, to) => {
      if (from === to) visualPoints.push(from)
    })

    expect(visualPoints).toContain(firstFrom)
    expect(visualPoints).toContain(lastFrom)
    expect(hidden.every((range) => range.presentation === 'external')).toBe(true)
    expect(hidden).toContainEqual({
      from: 0,
      to: doc.indexOf('first'),
      presentation: 'external',
    })
    const closingFrom = doc.indexOf('```', 3)
    const closingLineTo = doc.indexOf('\nafter')
    expect(hidden).toContainEqual({
      from: closingFrom,
      to: closingLineTo + 1,
      presentation: 'external',
    })
    expect(hidden.some(({ from, to }) => from <= firstFrom && to > firstFrom)).toBe(false)
  })

  it('keeps code rows unwrapped by default and opts into wrapping explicitly', () => {
    const doc = '```js\nfirst()\nlast()\n```'
    const state = stateAt(doc, doc.indexOf('first'))
    const defaultClasses = [...codeLineClasses(state).values()]
    const wrappedClasses = [...codeLineClasses(state, { lineWrapping: true }).values()]

    expect(defaultClasses.length).toBe(2)
    expect(defaultClasses.every((className) => !className.includes('xmd-cm-code-line-wrap'))).toBe(
      true,
    )
    expect(wrappedClasses.every((className) => className.includes('xmd-cm-code-line-wrap'))).toBe(
      true,
    )
  })

  it('uses editable content marks and hosts no overlay widgets in the decoration set', () => {
    const doc = '```js\nfirst()\nlast()\n```'
    const state = stateAt(doc, doc.indexOf('first'))
    const specs = (
      lineWrapping: boolean,
    ): Array<{ from: number; to: number; spec: Record<string, unknown> }> => {
      const result: Array<{ from: number; to: number; spec: Record<string, unknown> }> = []
      buildCodeBlockPreviewDecorations(state, [{ from: 0, to: doc.length }], {
        viewportMargin: 0,
        lineWrapping,
      }).between(0, doc.length, (from, to, value) => {
        result.push({ from, to, spec: value.spec as Record<string, unknown> })
      })
      return result
    }

    const unwrapped = specs(false)
    const wrapped = specs(true)
    const contentMarks = unwrapped.filter(({ spec }) => spec.class === 'xmd-cm-code-line-content')
    expect(contentMarks).toHaveLength(2)
    expect(contentMarks.every(({ spec }) => spec.inclusiveEnd === true)).toBe(true)
    // The copy/language controls and the shared scrollbar used to be widgets
    // anchored to the collapsed opening fence. CM6 only renders lines inside
    // the viewport ± margin, so those widgets left the DOM whenever the fence
    // scrolled out while editing a block taller than the screen. They are now
    // scrollDOM overlays owned by CodeBlockScrollPlugin (`pinnedOverlayTop`
    // provides the geometry), so the decoration set must contain no widgets
    // at all, wrapping or not.
    expect(unwrapped.filter(({ spec }) => 'widget' in spec)).toHaveLength(0)
    expect(wrapped.filter(({ spec }) => 'widget' in spec)).toHaveLength(0)
  })

  it('uses clipped native selection only inside one code block and keeps cross-block selection virtualized', () => {
    const doc = 'before\n```json\n{"enabled": true}\n```\nafter'
    const codeFrom = doc.indexOf('{')
    const codeSelection = EditorState.create({
      doc,
      selection: EditorSelection.range(codeFrom, codeFrom + 10),
      extensions: [markdown()],
    })
    const plainSelection = EditorState.create({
      doc,
      selection: EditorSelection.range(0, 6),
      extensions: [markdown()],
    })
    const crossBlockSelection = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown()],
    })
    const cursorOnly = stateAt(doc, codeFrom)
    const mermaid = '```mermaid\ngraph TD\n```'
    const mermaidSelection = EditorState.create({
      doc: mermaid,
      selection: EditorSelection.range(mermaid.indexOf('graph'), mermaid.indexOf('graph') + 5),
      extensions: [markdown()],
    })

    expect(selectionIntersectsFencedCode(codeSelection)).toBe(true)
    expect(selectionIntersectsFencedCode(plainSelection)).toBe(false)
    expect(selectionIntersectsFencedCode(crossBlockSelection)).toBe(false)
    expect(selectionIntersectsFencedCode(cursorOnly)).toBe(false)
    expect(selectionIntersectsFencedCode(mermaidSelection)).toBe(false)
  })

  describe('needsCodeCaretRepaint', () => {
    const doc = 'before\n```ts\nconst answer = 42\n```\nafter'
    const codeFrom = doc.indexOf('const')
    const multiCursor = (...heads: number[]): EditorState =>
      EditorState.create({
        doc,
        selection: EditorSelection.create(heads.map((head) => EditorSelection.cursor(head))),
        extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
      })

    it('repaints a single CM6 caret inside code but ignores one outside', () => {
      expect(needsCodeCaretRepaint(stateAt(doc, codeFrom + 3))).toBe(true)
      expect(needsCodeCaretRepaint(stateAt(doc, 0))).toBe(false)
    })

    it('fires when any of multiple cursors sits inside an editable code body', () => {
      expect(needsCodeCaretRepaint(multiCursor(codeFrom + 1, codeFrom + 5))).toBe(true)
      // One caret outside is enough as long as another is inside: the inside
      // one is CM6-drawn (multi-cursor keeps the overlay) and can go stale.
      expect(needsCodeCaretRepaint(multiCursor(0, codeFrom + 5))).toBe(true)
    })

    it('does not fire when every cursor is outside any code body', () => {
      expect(needsCodeCaretRepaint(multiCursor(0, doc.length))).toBe(false)
    })

    it('ignores Mermaid fences, whose preview owns its own rendering', () => {
      const mermaid = '```mermaid\ngraph TD\ngraph LR\n```'
      const first = mermaid.indexOf('graph TD')
      const second = mermaid.indexOf('graph LR')
      const state = EditorState.create({
        doc: mermaid,
        selection: EditorSelection.create([
          EditorSelection.cursor(first + 2),
          EditorSelection.cursor(second + 2),
        ]),
        extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
      })
      expect(needsCodeCaretRepaint(state)).toBe(false)
    })
  })

  describe('pinnedOverlayTop', () => {
    // Scrollbar: 5px tall, 3px margin — its top ends up 8px above the block
    // bottom, matching the old fence-relative `lastLineRect.bottom - 8`.
    const scrollbar = (geometry: OverlayPinGeometry): number | null =>
      pinnedOverlayTop('block-end', geometry, 5, 3)

    it('hides both overlays while the block does not intersect the viewport', () => {
      const above = { blockTop: -500, blockBottom: -100, viewportTop: 0, viewportBottom: 800 }
      const below = { blockTop: 900, blockBottom: 1400, viewportTop: 0, viewportBottom: 800 }
      expect(codeControlsTop(above)).toBeNull()
      expect(scrollbar(above)).toBeNull()
      expect(codeControlsTop(below)).toBeNull()
      expect(scrollbar(below)).toBeNull()
    })

    it('matches the legacy fence-anchored placement while the whole block is visible', () => {
      const geometry = { blockTop: 100, blockBottom: 400, viewportTop: 0, viewportBottom: 800 }
      expect(codeControlsTop(geometry)).toBe(73)
      expect(scrollbar(geometry)).toBe(392)
    })

    it('pins the controls to the viewport top once the fence scrolls out', () => {
      const geometry = { blockTop: -500, blockBottom: 400, viewportTop: 0, viewportBottom: 800 }
      expect(codeControlsTop(geometry)).toBe(0)
    })

    it('pins the scrollbar to the viewport bottom while the block continues below', () => {
      const geometry = { blockTop: 100, blockBottom: 2000, viewportTop: 0, viewportBottom: 800 }
      expect(scrollbar(geometry)).toBe(792)
    })

    it('slides the controls out with the block bottom instead of overflowing it', () => {
      // Only the last 30px of the block remain visible: the sticky header
      // must leave through the top rather than float over what follows.
      const geometry = { blockTop: -500, blockBottom: 30, viewportTop: 0, viewportBottom: 800 }
      expect(codeControlsTop(geometry)).toBe(0)
      // …but it never escapes above the block itself.
      const shallow = { blockTop: 5, blockBottom: 20, viewportTop: 0, viewportBottom: 800 }
      expect(codeControlsTop(shallow)).toBe(5)
    })

    it('keeps the scrollbar inside the block while the block enters from below', () => {
      const geometry = { blockTop: 700, blockBottom: 2000, viewportTop: 0, viewportBottom: 800 }
      // Preferred spot (viewportBottom - 8 = 792) is fine here…
      expect(scrollbar(geometry)).toBe(792)
      // …but with the block top just at the viewport bottom edge minus a few
      // pixels, the scrollbar must not float above the block.
      const entering = { blockTop: 795, blockBottom: 2000, viewportTop: 0, viewportBottom: 800 }
      expect(scrollbar(entering)).toBe(798)
    })

    it('follows the viewport while scrolling through a block taller than the screen', () => {
      const tall = (viewportTop: number): OverlayPinGeometry => ({
        blockTop: 0,
        blockBottom: 5000,
        viewportTop,
        viewportBottom: viewportTop + 800,
      })
      expect(codeControlsTop(tall(1000))).toBe(1000)
      expect(scrollbar(tall(1000))).toBe(1792)
      expect(codeControlsTop(tall(3000))).toBe(3000)
      expect(scrollbar(tall(3000))).toBe(3792)
    })
  })

  describe('codeBlockOverlayHorizontalGeometry', () => {
    it('anchors controls and scrollbar to the code card rather than the padded editor box', () => {
      const geometry = codeBlockOverlayHorizontalGeometry(
        { left: 140, width: 720 },
        { left: 20 },
        30,
        1,
      )

      // Code card occupies scrollDOM content coordinates 150..870.
      expect(geometry.controlsAnchorLeft).toBe(870)
      expect(geometry.scrollbarLeft).toBe(166)
      expect(geometry.trackWidth).toBe(688)
    })

    it('de-scales browser geometry before writing scrollDOM coordinates', () => {
      const geometry = codeBlockOverlayHorizontalGeometry(
        { left: 200, width: 900 },
        { left: 50 },
        25,
        1.5,
      )

      // Unscaled code card occupies scrollDOM content coordinates 125..725.
      expect(geometry.controlsAnchorLeft).toBe(725)
      expect(geometry.scrollbarLeft).toBe(141)
      expect(geometry.trackWidth).toBe(568)
    })
  })

  it('moves Home and End to logical code-line boundaries after horizontal scrolling', () => {
    const doc = 'before\n```js\nfirst long line\n```\nafter'
    const cursor = doc.indexOf('long') + 2
    const state = stateAt(doc, cursor)
    expect(fencedCodeLineBoundary(state, false)?.selection).toEqual({
      anchor: doc.indexOf('first'),
      head: doc.indexOf('first'),
    })
    expect(fencedCodeLineBoundary(state, true)?.selection).toEqual({
      anchor: doc.indexOf('first') + 'first long line'.length,
      head: doc.indexOf('first') + 'first long line'.length,
    })
    expect(fencedCodeLineBoundary(state, false, true)?.selection).toEqual({
      anchor: cursor,
      head: doc.indexOf('first'),
    })
    expect(fencedCodeLineBoundary(stateAt(doc, 2), false)).toBeNull()
  })

  it('does not register hidden ranges for Mermaid fences, which own their own preview', () => {
    const doc = '```mermaid\ngraph TD\n```'
    const state = stateAt(doc, doc.indexOf('graph'))
    expect(collectFencedCodeHiddenRanges(state, [{ from: 0, to: doc.length }])).toHaveLength(0)
  })

  it('does not construct widgets for code blocks outside the viewport', () => {
    const first = '```js\none()\n```'
    const gap = '\nplain\n'.repeat(100)
    const second = '```js\ntwo()\n```'
    const doc = `${first}${gap}${second}`
    const state = stateAt(doc, gap.indexOf('plain') + first.length)

    const ranges = decorations(state, 0, first.length)
    expect(ranges.some(([from, to]) => from >= first.length + gap.length && to > from)).toBe(false)
  })

  it('uses the complete structural body including leading and trailing blank lines', () => {
    const doc = '```python\n\nprint(1)\n\n```'
    const state = stateAt(doc, doc.indexOf('print'))
    const data = readFencedCode(state, 0, doc.length)

    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).toBe('\nprint(1)\n')
    expect(data.closingFrom).toBe(doc.lastIndexOf('```'))
  })

  it('supports indented long tilde fences and updates language at the real marker end', () => {
    const doc = '  ~~~~custom\nbody\n  ~~~~'
    const state = stateAt(doc, doc.indexOf('body'))
    const data = readFencedCode(state, 0, doc.length)

    expect(data.language).toBe('custom')
    expect(data.languageFrom).toBe('  ~~~~'.length)
    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).toBe('body')
  })

  it('uses structural fence marks for code blocks nested under list items', () => {
    const doc =
      '- 进入脚本执行目录\n    ```\n    cd /tongweb/coupons-gx-and-hkg/cardserver\n    ```\n- 下一步'
    const state = stateAt(doc, doc.indexOf('cd /tongweb'))
    let fencedFrom = -1
    let fencedTo = -1
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name !== 'FencedCode') return
        fencedFrom = node.from
        fencedTo = node.to
        return false
      },
    })

    const data = readFencedCode(state, fencedFrom, fencedTo)
    const closingMarkFrom = doc.lastIndexOf('```')
    const closingLineFrom = closingMarkFrom - 4
    const hidden = collectFencedCodeHiddenRanges(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    })

    expect(data.closingFrom).toBe(closingLineFrom)
    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).not.toContain('```')
    expect(hidden).toContainEqual({
      from: closingLineFrom,
      to: doc.indexOf('\n- 下一步') + 1,
      presentation: 'external',
    })
  })

  it('leaves Mermaid fences with extra info attributes to the Mermaid preview', () => {
    const doc = '```mermaid title="flow"\ngraph TD\n```'
    const state = stateAt(doc, doc.indexOf('graph'))
    const data = readFencedCode(state, 0, doc.length)

    expect(data.language).toBe('mermaid')
    expect(decorations(state, 0, doc.length)).toHaveLength(0)
  })

  it('keeps the final line editable when a fence is not closed', () => {
    const doc = '```js\nfirst()\nlast()'
    const state = stateAt(doc, doc.length)
    const data = readFencedCode(state, 0, doc.length)

    expect(data.closingFrom).toBeNull()
    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).toBe('first()\nlast()')
    const ranges = decorations(state, 0, doc.length)
    expect(ranges.some(([from, to]) => from <= doc.indexOf('last') && to >= doc.length)).toBe(false)
  })

  describe('fencedCodeBoundaryDeletion', () => {
    it('deletes the first ordinary blank line after a closed code block', () => {
      const doc = 'before\n```js\ncode()\n```\n\nafter'
      const blank = doc.indexOf('\n\nafter') + 1
      const state = stateAt(doc, blank)
      const spec = fencedCodeBoundaryDeletion(state, false)

      expect(spec).not.toBeNull()
      const next = state.update(spec!).state
      expect(next.doc.toString()).toBe('before\n```js\ncode()\n```\nafter')
      expect(next.doc.toString()).toContain('```js\ncode()\n```')
      expect(next.selection.main.head).toBe(blank - 1)
    })

    it('does not intercept Backspace before ordinary text immediately after a code block', () => {
      const doc = '```js\ncode()\n```\nafter'
      const after = doc.indexOf('after')
      expect(fencedCodeBoundaryDeletion(stateAt(doc, after), false)).toBeNull()
    })

    it('swallows Delete at the blank last row so it cannot reach the hidden closing fence', () => {
      const doc = '```js\n\n```'
      const blank = doc.indexOf('\n\n') + 1
      const state = stateAt(doc, blank)
      const spec = fencedCodeBoundaryDeletion(state, true)
      expect(spec).not.toBeNull()
      const next = state.update(spec!).state
      expect(next.doc.toString()).toBe(doc)
      expect(next.selection.main.head).toBe(blank)
    })

    it('deletes the whole block in one step when Backspace is pressed on an already-empty body', () => {
      const doc = 'before\n\n```js\n\n```\n\nafter'
      const blank = doc.indexOf('```js\n') + '```js\n'.length
      const state = stateAt(doc, blank)
      const openingFrom = doc.indexOf('```js')
      const spec = fencedCodeBoundaryDeletion(state, false)
      expect(spec).not.toBeNull()
      const next = state.update(spec!).state
      // The whole block (both fences and its blank body) is gone in one
      // transaction; the surrounding blank separator lines are untouched, so
      // the caret rests on an ordinary blank line at the block's old position.
      expect(next.doc.toString()).toBe('before\n\n\n\nafter')
      expect(next.doc.toString()).not.toContain('```')
      expect(next.selection.main.head).toBe(openingFrom)
    })

    it('leaves an empty document behind when the block is the only content', () => {
      const doc = '```js\n\n```'
      const blank = doc.indexOf('\n\n') + 1
      const state = stateAt(doc, blank)
      const spec = fencedCodeBoundaryDeletion(state, false)
      expect(spec).not.toBeNull()
      const next = state.update(spec!).state
      expect(next.doc.toString()).toBe('')
      expect(next.selection.main.head).toBe(0)
    })

    it('still protects Delete at a blank last row even when earlier code lines exist', () => {
      const doc = '```js\nfoo()\n\n```'
      const blank = doc.lastIndexOf('\n\n') + 1
      const state = stateAt(doc, blank)
      const spec = fencedCodeBoundaryDeletion(state, true)
      expect(spec).not.toBeNull()
      expect(state.update(spec!).state.doc.toString()).toBe(doc)
    })

    it('lets Backspace join a blank last row with a preceding code line normally', () => {
      const doc = '```js\nfoo()\n\n```'
      const blank = doc.lastIndexOf('\n\n') + 1
      const state = stateAt(doc, blank)
      expect(fencedCodeBoundaryDeletion(state, false)).toBeNull()
    })

    it('does nothing outside a fenced code block', () => {
      const doc = 'plain text\n\n```js\ncode\n```'
      const state = stateAt(doc, 3)
      expect(fencedCodeBoundaryDeletion(state, false)).toBeNull()
      expect(fencedCodeBoundaryDeletion(state, true)).toBeNull()
    })

    it('does nothing for a non-empty selection', () => {
      const doc = '```js\n\n```'
      const blank = doc.indexOf('\n\n') + 1
      const state = EditorState.create({
        doc,
        selection: EditorSelection.range(blank, blank + 1),
        extensions: [markdown()],
      })
      expect(fencedCodeBoundaryDeletion(state, false)).toBeNull()
    })

    it('does nothing when the fence is unclosed', () => {
      const doc = '```js\n'
      const state = stateAt(doc, doc.length)
      expect(fencedCodeBoundaryDeletion(state, false)).toBeNull()
      expect(fencedCodeBoundaryDeletion(state, true)).toBeNull()
    })
  })

  it('restores an editable code row when a selection deletes the whole final line', () => {
    const doc = '```js\nlast()\n```'
    const state = stateAt(doc, doc.indexOf('last'))
    const transaction = state.update({
      changes: { from: doc.indexOf('last'), to: doc.indexOf('```', 3) },
      selection: EditorSelection.cursor(doc.indexOf('last')),
      annotations: Transaction.userEvent.of('delete.selection'),
    })
    const repair = restoreEmptyFencedCodeBody(transaction)
    expect(repair).not.toBeNull()
    const next = state.update(transaction, repair!).state
    expect(next.doc.toString()).toBe('```js\n\n```')
    expect(next.selection.main.head).toBe('```js\n'.length)
    const data = readFencedCode(next, 0, next.doc.length)
    expect(data.codeFrom).toBeLessThan(data.closingFrom!)
  })

  it('pins the caret to the blank code line after deleting the final character', () => {
    const doc = '```js\nx\n```'
    const state = stateAt(doc, doc.indexOf('x') + 1)
    const transaction = state.update({
      changes: { from: doc.indexOf('x'), to: doc.indexOf('x') + 1 },
      selection: EditorSelection.cursor(doc.indexOf('x')),
      annotations: Transaction.userEvent.of('delete.backward'),
    })
    const repair = restoreEmptyFencedCodeBody(transaction)
    expect(repair).not.toBeNull()
    const next = state.update(transaction, repair!).state
    const data = readFencedCode(next, 0, next.doc.length)
    expect(next.doc.toString()).toBe('```js\n\n```')
    expect(next.selection.main.head).toBe(data.lastCodeLineFrom)
  })

  it('rejects a partial closing-fence deletion so adjacent code blocks cannot merge', () => {
    const doc = '```js\nfirst\n```\n```ts\nsecond\n```'
    const closing = doc.indexOf('```', 3)
    const state = stateAt(doc, closing)
    const partial = state.update({
      changes: { from: closing, to: closing + 3 },
      annotations: Transaction.userEvent.of('delete.selection'),
    })
    expect(partiallyDeletesFencedCodeFence(partial)).toBe(true)

    const whole = state.update({
      changes: { from: 0, to: closing + 3 },
      annotations: Transaction.userEvent.of('delete.selection'),
    })
    expect(partiallyDeletesFencedCodeFence(whole)).toBe(false)
  })

  describe('fencedCodeSelectAll', () => {
    it('selects only the code body, excluding both fences', () => {
      const doc = '```js\nconst answer = 42\n```'
      const state = stateAt(doc, doc.indexOf('answer'))
      const spec = fencedCodeSelectAll(state)
      expect(spec).not.toBeNull()
      const next = state.update(spec!).state
      const data = readFencedCode(next, 0, next.doc.length)
      expect(next.selection.main.from).toBe(data.codeFrom)
      expect(next.selection.main.to).toBe(data.codeTo)
      expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe(
        'const answer = 42',
      )
    })

    it('defers to the default select-all outside a code block', () => {
      const doc = 'plain text\n\n```js\ncode\n```'
      const state = stateAt(doc, 3)
      expect(fencedCodeSelectAll(state)).toBeNull()
    })
  })

  describe('fencedCodeFenceRedirectTarget', () => {
    it('redirects a click on the opening fence line into the first code line', () => {
      const doc = '```js\nfirst()\nlast()\n```'
      const state = stateAt(doc, 0)
      const data = readFencedCode(state, 0, doc.length)
      expect(fencedCodeFenceRedirectTarget(state, 0)).toBe(data.firstCodeLineFrom)
    })

    it('redirects a click on the closing fence line to the end of the code body', () => {
      const doc = '```js\nfirst()\nlast()\n```'
      const state = stateAt(doc, 0)
      const data = readFencedCode(state, 0, doc.length)
      expect(fencedCodeFenceRedirectTarget(state, data.closingFrom!)).toBe(data.codeTo)
    })

    it('does not redirect a position on an ordinary code line', () => {
      const doc = '```js\nfirst()\nlast()\n```'
      const state = stateAt(doc, 0)
      expect(fencedCodeFenceRedirectTarget(state, doc.indexOf('first'))).toBeNull()
    })

    it('ignores Mermaid fences, which own their own preview', () => {
      const doc = '```mermaid\ngraph TD\n```'
      const state = stateAt(doc, 0)
      expect(fencedCodeFenceRedirectTarget(state, 0)).toBeNull()
    })
  })

  it('keeps Enter in the middle of code inside the same fenced source block', () => {
    const doc = '```js\nconst answer = 42\n```'
    const cursor = doc.indexOf('answer') + 3
    const state = insertEnter(stateAt(doc, cursor), cursor)

    expect(state.doc.toString()).toBe('```js\nconst ans\nwer = 42\n```')
    expect(fencedCodeCount(state)).toBe(1)
    const data = readFencedCode(state, 0, state.doc.length)
    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).toBe('const ans\nwer = 42')
  })

  it('extends the existing code card when Enter is pressed at the end of its last line', () => {
    const doc = '```js\nlast()\n```'
    const cursor = doc.indexOf('\n```', doc.indexOf('last'))
    const state = insertEnter(stateAt(doc, cursor), cursor)

    expect(state.doc.toString()).toBe('```js\nlast()\n\n```')
    expect(fencedCodeCount(state)).toBe(1)
    const data = readFencedCode(state, 0, state.doc.length)
    const blankLine = state.doc.lineAt(data.codeTo)
    expect(blankLine.length).toBe(0)
    expect(data.lastCodeLineFrom).toBe(blankLine.from)
    expect(codeLineClasses(state).get(blankLine.from)).toContain('xmd-cm-code-line-last')
  })

  it('keeps a new line immediately before the closing fence in the current code card', () => {
    const doc = '```ts\nvalue\n```\nafter'
    const closingFrom = doc.indexOf('```', 3)
    const state = insertEnter(stateAt(doc, closingFrom), closingFrom)

    expect(state.doc.toString()).toBe('```ts\nvalue\n\n```\nafter')
    expect(fencedCodeCount(state)).toBe(1)
    const data = readFencedCode(state, 0, state.doc.toString().indexOf('\nafter'))
    expect(data.closingFrom).toBe(closingFrom + 1)
    expect(data.lastCodeLineFrom).toBe(state.doc.lineAt(data.codeTo).from)
  })

  it('preserves every empty trailing body line after repeated Enter transactions', () => {
    const initial = '```\nbody\n\n```'
    const firstClosing = initial.lastIndexOf('```')
    const state = insertEnter(stateAt(initial, firstClosing), firstClosing)
    const data = readFencedCode(state, 0, state.doc.length)

    expect(state.doc.toString()).toBe('```\nbody\n\n\n```')
    expect(state.doc.sliceString(data.codeFrom, data.codeTo)).toBe('body\n\n')
    expect(data.lastCodeLineFrom).toBe(state.doc.lineAt(data.codeTo).from)
    expect(codeLineClasses(state).get(data.lastCodeLineFrom)).toContain('xmd-cm-code-line-last')
  })

  it('does not create or merge fenced blocks when Enter extends the first of consecutive blocks', () => {
    const doc = '```js\none()\n```\n```ts\ntwo()\n```'
    const cursor = doc.indexOf('\n```', doc.indexOf('one'))
    const state = insertEnter(stateAt(doc, cursor), cursor)

    expect(fencedCodeCount(state)).toBe(2)
    expect(state.doc.toString()).toBe('```js\none()\n\n```\n```ts\ntwo()\n```')
    const secondFrom = state.doc.toString().indexOf('```ts')
    const second = readFencedCode(state, secondFrom, state.doc.length)
    expect(state.doc.sliceString(second.codeFrom, second.codeTo)).toBe('two()')
  })
})
