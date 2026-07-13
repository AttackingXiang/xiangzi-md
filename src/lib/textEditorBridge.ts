/**
 * 让全局 ⌘F / 「查找替换」命令能触发当前 TextEditor 的 CodeMirror 搜索面板。
 * 文本文件使用 CodeMirror 自带搜索；Markdown
 * 文件仍走应用自己的 FindBar，两者互不干扰。
 */
let openSearch: (() => void) | null = null

export const textEditorBridge = {
  /** TextEditor 挂载时注册打开搜索面板的回调，卸载时传 null 注销。 */
  set(fn: (() => void) | null): void {
    openSearch = fn
  },
  /** 打开当前 TextEditor 的搜索面板；无活跃编辑器时静默返回。 */
  openSearch(): void {
    openSearch?.()
  },
}
