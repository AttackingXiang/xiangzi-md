import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { aggregateHiddenRanges, hiddenRangeSource, type HiddenRangeBuilder } from './hiddenRanges'

function collect(decorations: ReturnType<typeof aggregateHiddenRanges>['atomic']) {
  const seen: Array<{ from: number; to: number }> = []
  decorations.between(0, 1e9, (from, to) => {
    seen.push({ from, to })
  })
  return seen
}

describe('aggregateHiddenRanges', () => {
  it('produces empty sets when no feature has registered a builder', () => {
    const state = EditorState.create({ doc: 'plain text', extensions: [markdown()] })
    const { decorations, atomic } = aggregateHiddenRanges(state, [{ from: 0, to: 10 }])

    expect(collect(decorations)).toHaveLength(0)
    expect(collect(atomic)).toHaveLength(0)
  })

  it('marks every contributed range atomic, but only paints ranges that opt in', () => {
    const builder: HiddenRangeBuilder = () => [
      { from: 0, to: 2, paint: true },
      { from: 4, to: 6, paint: false },
    ]
    const state = EditorState.create({
      doc: '## heading',
      extensions: [markdown({ base: markdownLanguage }), hiddenRangeSource.of(builder)],
    })
    const { decorations, atomic } = aggregateHiddenRanges(state, [{ from: 0, to: 10 }])

    expect(collect(atomic)).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
    ])
    expect(collect(decorations)).toEqual([{ from: 0, to: 2 }])
  })

  it('aggregates contributions from every registered builder into one set', () => {
    const first: HiddenRangeBuilder = () => [{ from: 0, to: 1 }]
    const second: HiddenRangeBuilder = () => [{ from: 2, to: 3 }]
    const state = EditorState.create({
      doc: 'abcdef',
      extensions: [markdown(), hiddenRangeSource.of(first), hiddenRangeSource.of(second)],
    })
    const { atomic } = aggregateHiddenRanges(state, [{ from: 0, to: 6 }])

    expect(collect(atomic)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ])
  })

  it('drops empty or inverted ranges instead of throwing', () => {
    const builder: HiddenRangeBuilder = () => [{ from: 5, to: 5 }]
    const state = EditorState.create({
      doc: 'abcdef',
      extensions: [markdown(), hiddenRangeSource.of(builder)],
    })
    const { atomic } = aggregateHiddenRanges(state, [{ from: 0, to: 6 }])

    expect(collect(atomic)).toHaveLength(0)
  })
})
