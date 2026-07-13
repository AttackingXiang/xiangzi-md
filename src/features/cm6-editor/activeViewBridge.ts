import type { EditorView } from '@codemirror/view'

let active: EditorView | null = null

/**
 * Process-local access to the focused CM6 editor. Cleanup is view-scoped so an
 * editor unmounting late cannot unregister a different active editor.
 */
export const cm6ActiveViewBridge = {
  register(view: EditorView): () => void {
    active = view
    return () => {
      if (active === view) active = null
    }
  },

  activate(view: EditorView): void {
    active = view
  },

  get(): EditorView | null {
    return active
  },

  clear(): void {
    active = null
  },
}
