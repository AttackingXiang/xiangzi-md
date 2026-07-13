import { Annotation, Transaction, type EditorState, type TransactionSpec } from '@codemirror/state'

/** Marks document replacement originating outside CodeMirror. */
export const externalDocumentSync = Annotation.define<boolean>()

export function createExternalSyncTransaction(
  state: EditorState,
  value: string,
  currentValue = state.doc.toString(),
): TransactionSpec | null {
  if (currentValue === value) return null
  return {
    changes: { from: 0, to: state.doc.length, insert: value },
    annotations: [externalDocumentSync.of(true), Transaction.addToHistory.of(false)],
  }
}

export function isExternalDocumentSync(transaction: Transaction): boolean {
  return transaction.annotation(externalDocumentSync) === true
}
