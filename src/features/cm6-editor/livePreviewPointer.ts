import type { EditorView } from '@codemirror/view'

/**
 * Map a click inside a rendered heading line back to the exact source
 * character under the pointer. Needed because a heading's `#`/space prefix
 * is `always-hidden` and atomic (see core/nodePolicy.ts) — it must never
 * capture the click, so a click anywhere in the heading text has to land on
 * that character, not snap to the line start.
 */
export function linePositionAtPointer(
  event: MouseEvent,
  view: EditorView,
  lineElement: HTMLElement,
): number {
  const sourceLine = view.state.doc.lineAt(view.posAtDOM(lineElement, 0))
  const contentOffset = lineElement.classList.contains('xmd-cm-heading')
    ? (/^ {0,3}#{1,6}\s+/.exec(sourceLine.text)?.[0].length ?? 0)
    : 0
  const contentFrom = Math.min(sourceLine.to, sourceLine.from + contentOffset)

  // DOM caret APIs preserve the character under the pointer even when CM6 has
  // replacement decorations before it. posAtCoords alone may otherwise snap
  // to the following block widget boundary.
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caret = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY)
  const range = caret ? null : documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY)
  const node = caret?.offsetNode ?? range?.startContainer
  const offset = caret?.offset ?? range?.startOffset
  let position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
  if (node && offset !== undefined && lineElement.contains(node)) {
    try {
      position = view.posAtDOM(node, offset)
    } catch {
      // A stale DOM text node can disappear during a decoration refresh; the
      // coordinate fallback below remains safe and is clamped to this heading.
    }
  }
  return Math.max(contentFrom, Math.min(sourceLine.to, position ?? contentFrom))
}
