import { history, undo, undoDepth } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  createExternalSyncTransaction,
  isExternalDocumentSync,
  planExternalDocumentChange,
} from './sync'

describe('CM6 external document synchronization', () => {
  it('does nothing when content is already current', () => {
    const state = EditorState.create({ doc: 'same' })
    expect(createExternalSyncTransaction(state, 'same')).toBeNull()
  })

  it('replaces the document and marks the transaction as external', () => {
    const state = EditorState.create({ doc: 'old', extensions: history() })
    const spec = createExternalSyncTransaction(state, 'new content')
    expect(spec).not.toBeNull()
    const transaction = state.update(spec!)
    expect(transaction.newDoc.toString()).toBe('new content')
    expect(isExternalDocumentSync(transaction)).toBe(true)
    expect(undoDepth(transaction.state)).toBe(0)
  })

  it('plans the smallest contiguous change without splitting Unicode code points', () => {
    expect(planExternalDocumentChange('prefix old suffix', 'prefix new suffix')).toEqual({
      from: 7,
      to: 10,
      insert: 'new',
    })
    expect(planExternalDocumentChange('😀 tail', '😁 tail')).toEqual({
      from: 0,
      to: 2,
      insert: '😁',
    })
  })

  it('preserves a selection after an unchanged suffix during external sync', () => {
    const state = EditorState.create({
      doc: 'alpha beta',
      selection: EditorSelection.cursor('alpha b'.length),
    })
    const spec = createExternalSyncTransaction(state, 'alpha X beta')
    const transaction = state.update(spec!)

    expect(transaction.changes.toJSON()).toEqual([6, [0, 'X '], 4])
    expect(transaction.newSelection.main.head).toBe('alpha X b'.length)
  })

  it('isolates edits on either side of an external replacement in undo history', () => {
    let state = EditorState.create({ doc: 'abc', extensions: history() })
    state = state.update({ changes: { from: 3, insert: '1' }, userEvent: 'input.type' }).state
    state = state.update(createExternalSyncTransaction(state, 'abc1!')!).state
    state = state.update({ changes: { from: 5, insert: '2' }, userEvent: 'input.type' }).state
    expect(undoDepth(state)).toBe(2)

    const dispatch = (transaction: ReturnType<EditorState['update']>): void => {
      state = transaction.state
    }
    expect(undo({ state, dispatch })).toBe(true)
    expect(state.doc.toString()).toBe('abc1!')
  })

  it('rejects a stale mirror before it can corrupt the editor document', () => {
    const state = EditorState.create({ doc: 'actual' })
    expect(() => createExternalSyncTransaction(state, 'next', 'stale')).toThrow(RangeError)
  })
})
