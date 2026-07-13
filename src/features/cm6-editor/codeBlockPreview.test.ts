import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildCodeBlockPreviewDecorations,
  codeLanguageOptions,
  mapCodeBlockChanges,
} from './codeBlockPreview'

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
  it('offers CM6 languages through a picker instead of accepting arbitrary typed input', () => {
    expect(codeLanguageOptions[0]).toEqual({ label: 'Text', value: '' })
    expect(codeLanguageOptions.some((entry) => entry.value === 'javascript')).toBe(true)
    expect(new Set(codeLanguageOptions.map((entry) => entry.value)).size).toBe(
      codeLanguageOptions.length,
    )
  })

  it('maps inner CM6 transactions to the authoritative Markdown source range', () => {
    const inner = EditorState.create({ doc: 'const n = 1' })
    const transaction = inner.update({ changes: { from: 10, to: 11, insert: '42' } })

    expect(mapCodeBlockChanges(6, transaction.changes)).toEqual([
      { from: 16, to: 17, insert: '42' },
    ])
  })

  it('preserves disjoint inner changes when mapping them to Markdown source', () => {
    const inner = EditorState.create({ doc: 'foo bar' })
    const transaction = inner.update({
      changes: [
        { from: 0, to: 3, insert: 'one' },
        { from: 4, to: 7, insert: 'two' },
      ],
    })

    expect(mapCodeBlockChanges(20, transaction.changes)).toEqual([
      { from: 20, to: 23, insert: 'one' },
      { from: 24, to: 27, insert: 'two' },
    ])
  })

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
