import { markdown } from '@codemirror/lang-markdown'
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildMathPreviewDecorations,
  collectMathHiddenRanges,
  findVisibleMathExpressions,
  markdownMathPreview,
  mathSourceRange,
  setMathSourceRange,
} from './mathPreview'
import { createExternalSyncTransaction } from './sync'

const mathStyles = readFileSync(new URL('./mathPreview.css', import.meta.url), 'utf8')

function stateAt(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  })
}

function deleteAtAtomicMathBoundary(doc: string, cursor: number, forward: boolean): EditorState {
  const previewState = stateAt(doc, cursor)
  const atoms = buildMathPreviewDecorations(previewState, [{ from: 0, to: doc.length }], {
    viewportMargin: 0,
  })
  let current = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [EditorView.atomicRanges.of(() => atoms)],
  })
  const view = Object.create(EditorView.prototype) as EditorView
  Object.defineProperty(view, 'state', { get: () => current })
  Object.defineProperty(view, 'dispatch', {
    value: (transaction: Transaction) => {
      current = transaction.state
    },
  })

  expect(forward ? deleteCharForward(view) : deleteCharBackward(view)).toBe(true)
  return current
}

describe('CM6 math preview', () => {
  it('finds inline and display math but excludes code', () => {
    const doc = 'Inline $x^2$ then\n$$\n\\sum_i x_i\n$$\nand `$ignored$`.\n```\n$alsoIgnored$\n```'
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: doc.length }], 0)

    expect(found.map(({ source, displayMode }) => [source, displayMode])).toEqual([
      ['x^2', false],
      ['\\sum_i x_i', true],
    ])
  })

  it('does not mistake currency, escaped dollars, or code-like locations for formulas', () => {
    const doc = [
      String.raw`Price $5 and $10; US$20 and CAD$30; \$escaped\$.`,
      String.raw`Valid $x + 1$ and $a + \$b$.`,
      '',
      '    $indentedCode$',
      String.raw`[$label$](https://example.com/$url$)`,
      String.raw`![alt $imageAlt$](image-$url$.png)`,
      String.raw`<code>$htmlCode$</code> and $outside$.`,
    ].join('\n')
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: doc.length }], 0)

    expect(found.map((item) => item.source)).toEqual([
      'x + 1',
      String.raw`a + \$b`,
      'label',
      'outside',
    ])
  })

  it('does not scan expressions outside the visible range', () => {
    const first = '$visible$'
    const doc = `${first}${' plain'.repeat(100)} $outside$`
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: first.length }], 0)

    expect(found.map((item) => item.source)).toEqual(['visible'])
  })

  it('accepts conventional multiline display math', () => {
    const doc = '$$\n\\frac{a}{b}\n$$'
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: doc.length }], 0)
    expect(found).toMatchObject([{ source: '\\frac{a}{b}', displayMode: true }])
  })

  it('only makes line-isolated double-dollar formulas block decorations', () => {
    const doc = 'before $$x$$ after\n  $$\n  x + y\n  $$  \nafter'
    const state = stateAt(doc)
    const found = findVisibleMathExpressions(state, [{ from: 0, to: doc.length }], 0)
    const openingLine = state.doc.line(2)
    const closingLine = state.doc.line(4)

    expect(found).toEqual([
      {
        from: openingLine.from,
        to: closingLine.to,
        source: 'x + y',
        displayMode: true,
      },
    ])
  })

  it('keeps rendered math mounted when the caret or selection touches it', () => {
    const doc = 'before $active$ after'
    for (const selection of [
      EditorSelection.cursor(doc.indexOf('active') + 2),
      EditorSelection.range(0, doc.length),
    ]) {
      const state = EditorState.create({ doc, selection, extensions: [markdown()] })
      const decorations = buildMathPreviewDecorations(state, [{ from: 0, to: doc.length }])
      let count = 0
      decorations.between(0, doc.length, () => {
        count += 1
      })
      expect(count).toBe(1)
    }
  })

  it('does not enter source mode for a selection-only transaction such as a single click', () => {
    const doc = 'before $x + 1$ after'
    let state = EditorState.create({
      doc,
      extensions: [markdown(), markdownMathPreview()],
    })
    state = state.update({ selection: EditorSelection.cursor(doc.indexOf('x')) }).state

    expect(state.field(mathSourceRange)).toBeNull()
    const decorations = buildMathPreviewDecorations(state, [{ from: 0, to: doc.length }])
    let count = 0
    decorations.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(1)
  })

  it('clears source mode when an external full-document sync switches documents', () => {
    const original = 'before $x + 1$ after'
    let state = EditorState.create({
      doc: original,
      extensions: [markdown(), mathSourceRange],
    })
    state = state.update({
      effects: setMathSourceRange.of({
        from: original.indexOf('$'),
        to: original.lastIndexOf('$') + 1,
        source: 'x + 1',
        displayMode: false,
      }),
    }).state
    expect(state.field(mathSourceRange)).not.toBeNull()

    const replacement = createExternalSyncTransaction(state, '# Another document')
    expect(replacement).not.toBeNull()
    state = state.update(replacement!).state

    expect(state.field(mathSourceRange)).toBeNull()
  })

  it('registers formula spans through the core hidden-range engine, not its own atomicRanges provider', () => {
    const doc = 'before $x$ after'
    const state = EditorState.create({
      doc,
      extensions: [markdown(), markdownMathPreview()],
    })
    // Invariant 3 (core/README.md): the only atomicRanges provider is the
    // aggregated one installed by hiddenRangesEngine() in markdownLivePreview.
    expect(state.facet(EditorView.atomicRanges)).toHaveLength(0)
    expect(
      collectMathHiddenRanges(state, [{ from: 0, to: doc.length }], { viewportMargin: 0 }),
    ).toEqual([
      {
        from: doc.indexOf('$'),
        to: doc.lastIndexOf('$') + 1,
        presentation: 'external',
      },
    ])
  })

  it('leaves a formula in source-edit mode out of the hidden atomic ranges', () => {
    const doc = 'before $x + 1$ after'
    let state = EditorState.create({ doc, extensions: [markdown(), mathSourceRange] })
    expect(
      collectMathHiddenRanges(state, [{ from: 0, to: doc.length }], { viewportMargin: 0 }),
    ).toHaveLength(1)

    state = state.update({
      effects: setMathSourceRange.of({
        from: doc.indexOf('$'),
        to: doc.lastIndexOf('$') + 1,
        source: 'x + 1',
        displayMode: false,
      }),
    }).state
    expect(
      collectMathHiddenRanges(state, [{ from: 0, to: doc.length }], { viewportMargin: 0 }),
    ).toHaveLength(0)
  })

  it.each([
    { name: 'inline', doc: 'A $x$ B', expected: 'A  B' },
    { name: 'display', doc: 'A\n$$\nx\n$$\nB', expected: 'A\n\nB' },
  ])('deletes a $name formula as one object from either atomic boundary', ({ doc, expected }) => {
    const expression = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: doc.length }], 0)[0]
    expect(expression).toBeDefined()

    expect(deleteAtAtomicMathBoundary(doc, expression.to, false).doc.toString()).toBe(expected)
    expect(deleteAtAtomicMathBoundary(doc, expression.from, true).doc.toString()).toBe(expected)
  })

  it('keeps large-document scanning bounded to the requested viewport', () => {
    const hidden = '$hidden$\n'.repeat(20_000)
    const visible = '$visible$'
    const doc = `${visible}\n${hidden}`
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: visible.length }], 0)
    expect(found.map((item) => item.source)).toEqual(['visible'])
  })

  it('uses legal auto-height block geometry and horizontal overflow for long formulas', () => {
    expect(mathStyles).toMatch(/\.xmd-cm-math-block\s*\{[^}]*padding:/s)
    expect(mathStyles).not.toMatch(/\.xmd-cm-math-block\s*\{[^}]*margin:/s)
    expect(mathStyles).not.toMatch(/\.xmd-cm-math-display\s*\{[^}]*min-height:/s)
    expect(mathStyles).toMatch(/\.xmd-cm-math-display\s*\{[^}]*overflow-x:\s*auto;/s)
    expect(mathStyles).toMatch(
      /\.xmd-cm-math-display \.katex-display\s*\{[^}]*min-width:\s*max-content;/s,
    )
  })
})
