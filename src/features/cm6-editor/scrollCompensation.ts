import type { EditorView } from '@codemirror/view'

/**
 * Runs `mutate` (which resizes `element`, e.g. swapping a loading placeholder
 * for a loaded image or a rendered Mermaid SVG) and, if that resize happens
 * above the visible viewport, adjusts `view.scrollDOM.scrollTop` by the exact
 * height delta so the content the user is looking at doesn't shift.
 *
 * This is deliberately not left to the browser's native CSS scroll anchoring:
 * CM6's `contentDOM` is a large contenteditable with absolutely/relatively
 * positioned line content, where anchor-node heuristics are unreliable, and a
 * browser-driven scrollTop write CM6 doesn't know about can itself trigger a
 * `viewportChanged` → decoration rebuild loop. Every other scroll adjustment
 * in this codebase goes through `view.scrollDOM` directly; this keeps the
 * same discipline instead of introducing a second, uncoordinated mechanism.
 */
/**
 * Applies a known height delta for content whose top edge sits at `elementTop`
 * (viewport coordinates), used directly by callers that observe a resize
 * after the fact — e.g. a `ResizeObserver` callback — instead of controlling
 * the mutation themselves.
 */
export function compensateScrollForHeightDelta(
  view: EditorView,
  elementTop: number,
  delta: number,
): void {
  if (delta === 0) return
  const scroller = view.scrollDOM
  if (elementTop < scroller.getBoundingClientRect().top) {
    scroller.scrollTop += delta
  }
}

export function resizeWithScrollCompensation(
  view: EditorView,
  element: HTMLElement,
  mutate: () => void,
): void {
  const before = element.getBoundingClientRect()
  mutate()
  const after = element.getBoundingClientRect()
  compensateScrollForHeightDelta(view, before.top, after.height - before.height)
  view.requestMeasure()
}
