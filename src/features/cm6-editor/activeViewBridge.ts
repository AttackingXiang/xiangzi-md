import type { EditorView } from '@codemirror/view'

let active: EditorView | null = null
const listeners = new Set<(view: EditorView | null) => void>()

function setActive(view: EditorView | null): void {
  if (active === view) return
  active = view
  for (const listener of [...listeners]) listener(view)
}

/**
 * Process-local access to the focused CM6 editor. Cleanup is view-scoped so an
 * editor unmounting late cannot unregister a different active editor.
 */
export const cm6ActiveViewBridge = {
  register(view: EditorView): () => void {
    setActive(view)
    return () => {
      if (active === view) setActive(null)
    }
  },

  activate(view: EditorView): void {
    setActive(view)
  },

  get(): EditorView | null {
    return active
  },

  clear(): void {
    setActive(null)
  },

  subscribe(listener: (view: EditorView | null) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
