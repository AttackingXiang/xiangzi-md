/**
 * Registry of currently mounted modal dialogs, innermost last.
 *
 * Escape must close exactly one modal: the innermost one. Deciding that from
 * the DOM (walking up from `event.target` to the nearest `[aria-modal]`) looks
 * equivalent but is not — when focus sits on `document.body`, which happens
 * routinely in the Tauri WebView right after a child dialog closes, the walk
 * finds nothing and every open modal considers itself the target. Mount order
 * is the only signal that stays correct regardless of where focus is.
 */
const stack: HTMLElement[] = []

export function pushModal(element: HTMLElement): void {
  stack.push(element)
}

export function popModal(element: HTMLElement): void {
  const index = stack.lastIndexOf(element)
  if (index >= 0) stack.splice(index, 1)
}

/** True when `element` is the innermost open modal and should own Escape. */
export function isTopmostModal(element: HTMLElement | null): boolean {
  return element !== null && stack.at(-1) === element
}

/** True while any modal owns application focus. */
export function hasOpenModal(): boolean {
  return stack.length > 0
}

/** For tests only — production entries are balanced by useModalFocus. */
export function resetModalStack(): void {
  stack.length = 0
}
