import type { EditorView } from '@codemirror/view'

export interface SelectionEndpointRect {
  left: number
  right: number
  top: number
  bottom: number
}

function finiteRect(rect: SelectionEndpointRect | null): SelectionEndpointRect | null {
  if (!rect) return null
  return [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) ? rect : null
}

/** Read a CM6 endpoint without letting a stale/invalid geometry value escape. */
export function selectionEndpointRect(
  view: EditorView,
  position: number,
): SelectionEndpointRect | null {
  try {
    return finiteRect(view.coordsAtPos(position))
  } catch {
    return null
  }
}

/**
 * Prefer the browser caret API for decorated text, then fall back to CM6.
 * The returned position is always clamped by the caller to its owning surface.
 */
export function documentPositionAtPoint(
  view: EditorView,
  x: number,
  y: number,
  container: HTMLElement,
): number | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caret = documentWithCaret.caretPositionFromPoint?.(x, y)
  const range = caret ? null : documentWithCaret.caretRangeFromPoint?.(x, y)
  const node = caret?.offsetNode ?? range?.startContainer
  const offset = caret?.offset ?? range?.startOffset
  if (node && offset !== undefined && container.contains(node)) {
    try {
      return view.posAtDOM(node, offset)
    } catch {
      // Decorations can replace the text node between hit-testing and mapping.
    }
  }
  return view.posAtCoords({ x, y }, false)
}
