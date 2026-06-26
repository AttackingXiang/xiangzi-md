import type { EditorView } from '@milkdown/kit/prose/view'

/** 让查找/替换等 UI 能拿到当前活跃编辑器的 ProseMirror 视图 */
let view: EditorView | null = null

export const editorBridge = {
  set(v: EditorView | null): void {
    view = v
  },
  get(): EditorView | null {
    return view
  }
}
