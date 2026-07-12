import type { EditorView } from '@milkdown/kit/prose/view'

/** 让查找/替换等 UI 能拿到当前活跃编辑器的 ProseMirror 视图 */
let view: EditorView | null = null
let markUserEdit: (() => void) | null = null
const registered = new Map<EditorView, (() => void) | null>()

export const editorBridge = {
  set(v: EditorView | null, onUserEdit?: () => void): void {
    registered.clear()
    view = v
    markUserEdit = v ? (onUserEdit ?? null) : null
    if (v) registered.set(v, markUserEdit)
  },
  register(v: EditorView, onUserEdit?: () => void): void {
    registered.set(v, onUserEdit ?? null)
    if (!view) {
      view = v
      markUserEdit = onUserEdit ?? null
    }
  },
  activate(v: EditorView): void {
    if (!registered.has(v)) return
    view = v
    markUserEdit = registered.get(v) ?? null
  },
  unregister(v: EditorView): void {
    registered.delete(v)
    if (view !== v) return
    const fallback = Array.from(registered.keys()).at(-1) ?? null
    view = fallback
    markUserEdit = fallback ? (registered.get(fallback) ?? null) : null
  },
  get(): EditorView | null {
    return view
  },
  markUserEdit(): void {
    markUserEdit?.()
  },
}
