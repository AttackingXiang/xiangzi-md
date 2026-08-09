/**
 * 文件类型路由：区分「走 Milkdown 的 Markdown 文档」与「走 CodeMirror 的纯文本
 * / 代码 / 结构化数据」。规则很简单——只有 Markdown 家族扩展名进 Milkdown，
 * 其余受文件能力清单支持的格式（含无扩展名、日志、JSON、代码）都交给
 * TextEditor。这样不会把 .txt/.log 当 Markdown 规范化，所有入口也共享同一规则。
 */
import { isMarkdownFile } from './fileCapabilities'

export type FileKind = 'markdown' | 'text'

export {
  fileExtension,
  isKnownTextFile,
  KNOWN_TEXT_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
} from './fileCapabilities'

/** 按文件名判断走哪个编辑器内核。 */
export function classifyFile(name: string): FileKind {
  return isMarkdownFile(name) ? 'markdown' : 'text'
}
