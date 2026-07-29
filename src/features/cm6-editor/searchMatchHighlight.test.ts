import { markdown } from '@codemirror/lang-markdown'
import { search, SearchQuery, setSearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeInlineSearchMatchDecorations } from './searchMatchHighlight'

function highlightedRanges(doc: string, query: string, from: number, to: number) {
  const initial = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown(), search()],
  })
  const state = initial.update({
    effects: setSearchQuery.of(new SearchQuery({ search: query, literal: true })),
  }).state
  const ranges: Array<{ from: number; to: number }> = []
  activeInlineSearchMatchDecorations(state).between(0, state.doc.length, (rangeFrom, rangeTo) => {
    ranges.push({ from: rangeFrom, to: rangeTo })
  })
  return ranges
}

describe('active inline search match highlight', () => {
  const doc = 'plain needle and `inline needle`'
  const inlineNeedle = doc.lastIndexOf('needle')

  it('paints an exact active query match inside inline code', () => {
    expect(highlightedRanges(doc, 'needle', inlineNeedle, inlineNeedle + 6)).toEqual([
      {
        from: inlineNeedle,
        to: inlineNeedle + 6,
      },
    ])
  })

  it('leaves ordinary-text search matches to the normal selection painter', () => {
    const plainNeedle = doc.indexOf('needle')
    expect(highlightedRanges(doc, 'needle', plainNeedle, plainNeedle + 6)).toEqual([])
  })

  it('does not paint an inline selection that is not the active query match', () => {
    expect(highlightedRanges(doc, 'other', inlineNeedle, inlineNeedle + 6)).toEqual([])
  })
})
