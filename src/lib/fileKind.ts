/**
 * 文件类型路由：区分「走 Milkdown 的 Markdown 文档」与「走 CodeMirror 的纯文本
 * / 代码 / 结构化数据」。规则很简单——只有 Markdown 家族扩展名进 Milkdown，
 * 其余一切（含无扩展名、日志、JSON、代码）都交给 TextEditor。这样既不会把
 * .txt/.log 当 Markdown 规范化，也不需要维护一份庞大的「文本扩展名白名单」。
 */
export type FileKind = 'markdown' | 'text'

/** Markdown 家族扩展名（与 Rust 侧 MARKDOWN_EXTENSIONS 保持一致） */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mdx'] as const

/** 取文件名的小写扩展名（不含点）；无扩展名返回空串。 */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  // dot > 0 排除「以点开头的 dotfile」被误当成扩展名（如 .gitignore）
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 按文件名判断走哪个编辑器内核。 */
export function classifyFile(name: string): FileKind {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(fileExtension(name))
    ? 'markdown'
    : 'text'
}
