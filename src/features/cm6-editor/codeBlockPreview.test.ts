import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildCodeBlockPreviewDecorations } from './codeBlockPreview'

function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  })
}

function replacements(state: EditorState, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  buildCodeBlockPreviewDecorations(state, [{ from, to }], { viewportMargin: 0 }).between(
    0,
    state.doc.length,
    (rangeFrom, rangeTo) => {
      ranges.push([rangeFrom, rangeTo])
    },
  )
  return ranges
}

describe('CM6 fenced code preview', () => {
  it('replaces a visible inactive fenced block with one widget', () => {
    const doc = '```ts\nconst answer = 42\n```\n\nafter'
    const state = stateAt(doc, doc.length)

    expect(replacements(state, 0, doc.indexOf('\n\nafter'))).toEqual([
      [0, doc.indexOf('\n\nafter')],
    ])
  })

  it('shows source when the cursor is inside the fenced block', () => {
    const doc = '```ts\nconst answer = 42\n```'
    const state = stateAt(doc, doc.indexOf('answer'))

    expect(replacements(state, 0, doc.length)).toEqual([])
  })

  it('does not construct widgets for code blocks outside the viewport', () => {
    const first = '```js\none()\n```'
    const gap = '\nplain\n'.repeat(100)
    const second = '```js\ntwo()\n```'
    const doc = `${first}${gap}${second}`
    const state = stateAt(doc, gap.indexOf('plain') + first.length)

    expect(replacements(state, 0, first.length)).toEqual([[0, first.length]])
  })
})
