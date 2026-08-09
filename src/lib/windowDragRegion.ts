import type { PointerEvent as ReactPointerEvent } from 'react'
import { startWindowDragging } from './windowActions'

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [contenteditable="true"], [data-window-drag-interactive]'

export function isWindowDragInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}

export function handleWindowDragPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  enabled = true,
): void {
  if (
    !enabled ||
    event.defaultPrevented ||
    event.button !== 0 ||
    isWindowDragInteractiveTarget(event.target)
  )
    return

  void startWindowDragging().catch((error: unknown) =>
    console.error('Window dragging failed', error),
  )
}
