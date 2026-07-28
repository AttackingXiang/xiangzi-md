import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  selectionCoordinatorState,
  selectionPresentationFor,
  selectionSnapshot,
  setPointerSelectionActive,
  setSelectionSurface,
} from './selectionCoordinator'

function stateWithSelection(doc: string, anchor: number, head: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage }), selectionCoordinatorState],
  })
}

const focusedDocument = {
  focused: true,
  enabled: true,
  preferViewportNativeSelection: false,
  surface: 'document' as const,
}

describe('selectionCoordinator', () => {
  it('owns pointer and nested-surface state in one snapshot', () => {
    const initial = stateWithSelection('text', 0, 0)
    const active = initial.update({
      effects: [setPointerSelectionActive.of(true), setSelectionSurface.of('table-cell')],
    }).state
    expect(selectionSnapshot(active)).toEqual({ pointerActive: true, surface: 'table-cell' })

    const finished = active.update({
      effects: [setPointerSelectionActive.of(false), setSelectionSurface.of('document')],
    }).state
    expect(selectionSnapshot(finished)).toEqual({ pointerActive: false, surface: 'document' })
  })

  it('uses native painting for a focused single-line document range', () => {
    const state = stateWithSelection('first line\nsecond line', 1, 5)
    expect(
      selectionPresentationFor(state, [{ from: 0, to: state.doc.length }], focusedDocument),
    ).toBe('native-line')
  })

  it('keeps CM6 painting when focus, preview, or document ownership is absent', () => {
    const state = stateWithSelection('first line', 1, 5)
    const visible = [{ from: 0, to: state.doc.length }]
    expect(selectionPresentationFor(state, visible, { ...focusedDocument, focused: false })).toBe(
      'cm6',
    )
    expect(selectionPresentationFor(state, visible, { ...focusedDocument, enabled: false })).toBe(
      'cm6',
    )
    expect(
      selectionPresentationFor(state, visible, {
        ...focusedDocument,
        surface: 'table-cell',
      }),
    ).toBe('native-table')
  })

  it('uses native code painting only inside one editable fenced code body', () => {
    const doc = '```ts\nconst value = 1\n```\nnext'
    const from = doc.indexOf('const')
    const state = stateWithSelection(doc, from, from + 5)
    expect(selectionPresentationFor(state, [{ from: 0, to: doc.length }], focusedDocument)).toBe(
      'native-code',
    )
  })

  it('uses viewport-native painting for a mounted cross-line range only when requested', () => {
    const doc = 'first line\nsecond line\nthird line'
    const state = stateWithSelection(doc, 3, 24)
    expect(selectionPresentationFor(state, [{ from: 0, to: doc.length }], focusedDocument)).toBe(
      'cm6',
    )
    expect(
      selectionPresentationFor(state, [{ from: 0, to: doc.length }], {
        ...focusedDocument,
        preferViewportNativeSelection: true,
      }),
    ).toBe('native-line')
    expect(
      selectionPresentationFor(state, [{ from: 12, to: doc.length }], {
        ...focusedDocument,
        preferViewportNativeSelection: true,
      }),
    ).toBe('cm6')
  })
})
