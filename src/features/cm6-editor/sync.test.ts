import { history, undoDepth } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { createExternalSyncTransaction, isExternalDocumentSync } from './sync'

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
})
