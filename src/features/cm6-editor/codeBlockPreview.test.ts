import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  buildCodeBlockPreviewDecorations,
  buildCodeFenceAtomicRanges,
  codeLanguageOptions,
  readFencedCode,
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
    (rangeFrom, rangeTo) => {
      ranges.push([rangeFrom, rangeTo, ''])
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

  it('keeps first and last code lines visually decorated while atomic ranges only cover fences', () => {
    const doc = '```ts\nfirst()\nlast()\n```\nafter'
    const state = stateAt(doc, doc.indexOf('first'))
    const visual = buildCodeBlockPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      viewportMargin: 0,
    })
    const atomic = buildCodeFenceAtomicRanges(state, [{ from: 0, to: doc.length }], 0)
    const firstFrom = doc.indexOf('first')
    const lastFrom = doc.indexOf('last')
    const visualPoints: number[] = []
    visual.between(0, doc.length, (from, to) => {
      if (from === to) visualPoints.push(from)
    })
    const atomicRanges: Array<[number, number]> = []
    atomic.between(0, doc.length, (from, to) => {
      atomicRanges.push([from, to])
    })

    expect(visualPoints).toContain(firstFrom)
    expect(visualPoints).toContain(lastFrom)
    expect(atomicRanges).toContainEqual([0, doc.indexOf('first')])
    expect(atomicRanges).toContainEqual([doc.indexOf('```', 3), doc.indexOf('after')])
    expect(atomicRanges.some(([from, to]) => from <= firstFrom && to > firstFrom)).toBe(false)
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
})
