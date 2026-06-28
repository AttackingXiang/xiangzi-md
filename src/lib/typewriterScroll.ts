interface RectLike {
  top: number
  height: number
}

/** Return the scroll delta for a collapsed caret, never for a text selection. */
export function typewriterScrollDelta(
  selectionCollapsed: boolean,
  pointerSelecting: boolean,
  caretRect: RectLike,
  viewportRect: RectLike,
): number | null {
  if (!selectionCollapsed || pointerSelecting) return null
  if (caretRect.height === 0 && caretRect.top === 0) return null

  const delta = caretRect.top + caretRect.height / 2 - (viewportRect.top + viewportRect.height / 2)
  return Math.abs(delta) > 2 ? delta : null
}
