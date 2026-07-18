import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  aggregateHiddenRanges,
  hiddenRangeSource,
  PRESERVED_HIDDEN_SOURCE_CLASS,
  preserveLineLeadingHiddenSource,
  type HiddenRangeBuilder,
} from './hiddenRanges'

function collect(decorations: ReturnType<typeof aggregateHiddenRanges>['atomic']) {
  const seen: Array<{ from: number; to: number }> = []
  decorations.between(0, 1e9, (from, to) => {
    seen.push({ from, to })
  })
  return seen
}

function collectSpecs(decorations: ReturnType<typeof aggregateHiddenRanges>['decorations']) {
  const seen: Array<{
    from: number
    to: number
    className?: string
    hiddenSource?: string
    ariaHidden?: string
  }> = []
  decorations.between(0, 1e9, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> }
    seen.push({
      from,
      to,
      className: spec.class,
      hiddenSource: spec.attributes?.['data-xmd-hidden-source'],
      ariaHidden: spec.attributes?.['aria-hidden'],
    })
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

  it('keeps atomic behaviour independent from each range presentation', () => {
    const builder: HiddenRangeBuilder = () => [
      { from: 1, to: 2 },
      { from: 2, to: 4, presentation: 'preserve-text' },
      { from: 4, to: 6, presentation: 'external' },
    ]
    const state = EditorState.create({
      doc: 'abcdefghij',
      extensions: [markdown({ base: markdownLanguage }), hiddenRangeSource.of(builder)],
    })
    const { decorations, atomic } = aggregateHiddenRanges(state, [{ from: 0, to: 10 }])

    expect(collect(atomic)).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 6 },
    ])
    expect(collect(decorations)).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 4 },
    ])
    expect(collectSpecs(decorations)).toEqual([
      {
        from: 1,
        to: 2,
        className: undefined,
        hiddenSource: undefined,
        ariaHidden: undefined,
      },
      {
        from: 2,
        to: 4,
        className: PRESERVED_HIDDEN_SOURCE_CLASS,
        hiddenSource: 'true',
        ariaHidden: 'true',
      },
    ])
  })

  it('preserves a complete line-leading chain across nested Markdown constructs', () => {
    const state = EditorState.create({ doc: '  > # **title**' })
    const ranges = preserveLineLeadingHiddenSource(state, [
      { from: 2, to: 4 },
      { from: 4, to: 6 },
      { from: 6, to: 8 },
      { from: 13, to: 15 },
    ])

    expect(ranges).toEqual([
      { from: 2, to: 4, presentation: 'preserve-text' },
      { from: 4, to: 6, presentation: 'preserve-text' },
      { from: 6, to: 8, presentation: 'preserve-text' },
      { from: 13, to: 15 },
    ])
  })

  it('stops preservation at feature-owned widgets and keeps whole-line source replaced', () => {
    const listState = EditorState.create({ doc: '- **item**' })
    expect(
      preserveLineLeadingHiddenSource(listState, [
        { from: 0, to: 2, presentation: 'external' },
        { from: 2, to: 4 },
      ]),
    ).toEqual([
      { from: 0, to: 2, presentation: 'external' },
      { from: 2, to: 4 },
    ])

    const wholeLineState = EditorState.create({ doc: '===' })
    expect(preserveLineLeadingHiddenSource(wholeLineState, [{ from: 0, to: 3 }])).toEqual([
      { from: 0, to: 3 },
    ])
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
