import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildMathPreviewDecorations, findVisibleMathExpressions } from './mathPreview'

function stateAt(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  })
}

describe('CM6 math preview', () => {
  it('finds inline and display math but excludes code', () => {
    const doc = 'Inline $x^2$ and $$\\sum_i x_i$$ then `$ignored$`.\n```\n$alsoIgnored$\n```'
    const found = findVisibleMathExpressions(stateAt(doc), [{ from: 0, to: doc.length }], 0)

    expect(found.map(({ source, displayMode }) => [source, displayMode])).toEqual([
      ['x^2', false],
      ['\\sum_i x_i', true],
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

  it('leaves an active expression as editable source', () => {
    const doc = 'before $active$ after'
    const state = stateAt(doc, doc.indexOf('active') + 2)
    const decorations = buildMathPreviewDecorations(state, [{ from: 0, to: doc.length }])
    let count = 0
    decorations.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(0)
  })
})
