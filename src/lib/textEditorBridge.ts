/**
 * 让全局 ⌘F / 「查找替换」命令能触发当前 TextEditor 的 CodeMirror 搜索面板。
 * 与 editorBridge（ProseMirror）平行：文本文件用 CodeMirror 自带搜索，Markdown
 * 文件仍走应用自己的 FindBar，两者互不干扰。
 */
let openSearch: (() => void) | null = null

export const textEditorBridge = {
  /** TextEditor 挂载时注册打开搜索面板的回调，卸载时传 null 注销。 */
  set(fn: (() => void) | null): void {
    openSearch = fn
  },
  /** 是否有活跃的 TextEditor（用于判断 ⌘F 该走哪套搜索）。 */
  isActive(): boolean {
    return openSearch !== null
  },
  /** 打开当前 TextEditor 的搜索面板；无活跃编辑器时静默返回。 */
  openSearch(): void {
    openSearch?.()
  },
}
