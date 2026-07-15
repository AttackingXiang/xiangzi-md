import { isolateHistory } from '@codemirror/commands'
import { Annotation, Transaction, type EditorState, type TransactionSpec } from '@codemirror/state'

/** Marks document replacement originating outside CodeMirror. */
export const externalDocumentSync = Annotation.define<boolean>()

export interface ContiguousDocumentChange {
  from: number
  to: number
  insert: string
}

/** Matches CodeMirror's internal document model, which stores every line break as LF. */
export function normalizeEditorDocument(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function previousCodePointStart(value: string, end: number): number {
  if (end >= 2) {
    const low = value.charCodeAt(end - 1)
    const high = value.charCodeAt(end - 2)
    if (low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff) return end - 2
  }
  return end - 1
}

/** Smallest single replacement, with boundaries kept outside surrogate pairs. */
export function planExternalDocumentChange(
  currentValue: string,
  nextValue: string,
): ContiguousDocumentChange | null {
  if (currentValue === nextValue) return null
  let from = 0
  while (from < currentValue.length && from < nextValue.length) {
    const currentPoint = currentValue.codePointAt(from)
    const nextPoint = nextValue.codePointAt(from)
    if (currentPoint !== nextPoint) break
    from += currentPoint !== undefined && currentPoint > 0xffff ? 2 : 1
  }

  let currentTo = currentValue.length
  let nextTo = nextValue.length
  while (currentTo > from && nextTo > from) {
    const currentStart = previousCodePointStart(currentValue, currentTo)
    const nextStart = previousCodePointStart(nextValue, nextTo)
    if (currentValue.codePointAt(currentStart) !== nextValue.codePointAt(nextStart)) break
    currentTo = currentStart
    nextTo = nextStart
  }
  return { from, to: currentTo, insert: nextValue.slice(from, nextTo) }
}

export function createExternalSyncTransaction(
  state: EditorState,
  value: string,
  currentValue = state.doc.toString(),
): TransactionSpec | null {
  const normalizedCurrentValue = normalizeEditorDocument(currentValue)
  const normalizedValue = normalizeEditorDocument(value)
  if (normalizedCurrentValue.length !== state.doc.length) {
    throw new RangeError(
      `CM6 external sync length mismatch: mirror=${normalizedCurrentValue.length}, doc=${state.doc.length}`,
    )
  }
  const change = planExternalDocumentChange(normalizedCurrentValue, normalizedValue)
  if (!change) return null
  return {
    changes: change,
    annotations: [
      externalDocumentSync.of(true),
      Transaction.addToHistory.of(false),
      isolateHistory.of('full'),
    ],
  }
}

export function isExternalDocumentSync(transaction: Transaction): boolean {
  return transaction.annotation(externalDocumentSync) === true
}
