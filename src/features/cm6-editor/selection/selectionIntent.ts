import { Annotation, type Transaction } from '@codemirror/state'

/** Why a selection-related transaction was dispatched. */
export type SelectionIntent =
  | 'pointer'
  | 'keyboard'
  | 'programmatic'
  | 'contextmenu'
  | 'geometry-repaint'
  | 'surface-sync'

/** Shared annotation used by selection consumers instead of private flags. */
export const selectionIntent = Annotation.define<SelectionIntent>()

export function transactionHasSelectionIntent(
  transaction: Transaction,
  intent: SelectionIntent,
): boolean {
  const annotated = transaction.annotation(selectionIntent)
  if (annotated) return annotated === intent
  if (intent === 'pointer') return transaction.isUserEvent('select.pointer')
  if (intent === 'keyboard') return transaction.isUserEvent('select.keyboard')
  return false
}
