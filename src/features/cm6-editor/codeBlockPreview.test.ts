import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
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

function codeLineClasses(state: EditorState): Map<number, string> {
  const classes = new Map<number, string>()
  buildCodeBlockPreviewDecorations(state, [{ from: 0, to: state.doc.length }], {
    viewportMargin: 0,
  }).between(0, state.doc.length, (from, to, value) => {
    const spec: unknown = value.spec
    if (from !== to || typeof spec !== 'object' || spec === null || !('class' in spec)) return
    const className = (spec as Record<string, unknown>).class
    if (typeof className === 'string') {
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
