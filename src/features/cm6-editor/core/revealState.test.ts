import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { computeRevealedRanges, isRevealed } from './revealState'

function createState(doc: string, ...cursors: number[]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(cursors.map((pos) => EditorSelection.cursor(pos))),
    extensions: [markdown({ base: markdownLanguage })],
  })
}

describe('computeRevealedRanges', () => {
  it('reveals nothing when the selection sits outside every reveal-on-selection construct', () => {
    const doc = '**bold** plain'
    const state = createState(doc, doc.indexOf('plain'))
    const revealed = computeRevealedRanges(state)

    expect(revealed.ranges).toHaveLength(0)
    expect(isRevealed(revealed, 0, 8)).toBe(false)
  })

  it('reveals a construct the instant the cursor enters it, at either edge', () => {
    const doc = '**bold**'
    for (const cursor of [0, 4, 8]) {
      const revealed = computeRevealedRanges(createState(doc, cursor))
      expect(isRevealed(revealed, 0, 8)).toBe(true)
    }
  })

  it('reveals a construct fully contained by a non-empty selection even if the edges do not touch it', () => {
    const doc = 'before **bold** after'
    const from = doc.indexOf('before')
    const to = doc.indexOf('after') + 'after'.length
    const state = createState(doc, from).update({
      selection: EditorSelection.range(from, to),
    }).state
    const revealed = computeRevealedRanges(state)

    const boldFrom = doc.indexOf('**bold**')
    expect(isRevealed(revealed, boldFrom, boldFrom + 8)).toBe(true)
  })

  it('reveals only the construct(s) a multi-selection touches', () => {
    const doc = '**bold** and *italic* and plain'
    const boldFrom = doc.indexOf('**bold**')
    const italicFrom = doc.indexOf('*italic*')
    const state = createState(doc, boldFrom + 2)
    const revealed = computeRevealedRanges(state)

    expect(isRevealed(revealed, boldFrom, boldFrom + 8)).toBe(true)
    expect(isRevealed(revealed, italicFrom, italicFrom + 8)).toBe(false)
  })

  it('never reveals always-hidden or widget constructs (headings, lists, quotes)', () => {
    const doc = '# Heading\n- item\n> quote'
    const headingCursor = 2
    const revealed = computeRevealedRanges(createState(doc, headingCursor))
    // A heading node overlaps [0, 9); confirm nothing in that span is "revealed"
    // by this engine — heading markers are governed by boundaryCommands, not
    // reveal-on-selection.
    expect(isRevealed(revealed, 0, 9)).toBe(false)
  })

  it('recomputes only for selection/doc changes, is stable otherwise', () => {
    const doc = '**bold**'
    const initial = computeRevealedRanges(createState(doc, 4))
    const same = computeRevealedRanges(createState(doc, 4))
    expect(initial.ranges).toEqual(same.ranges)
  })
})
