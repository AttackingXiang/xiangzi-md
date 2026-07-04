import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'
import { escapeHtmlText } from './exportStyles'

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  shell: 'shell',
  sh: 'shell',
  bash: 'shell',
}

const PLAIN_TEXT_LANGUAGES = new Set(['', 'text', 'txt', 'plain', 'plaintext'])

/**
 * 导出的 HTML 是脱离 App 运行时的静态文件，但 generateExportHtml 会把当前
 * 全部样式表（含 foundation.css 的 --code-* 变量定义）原样内联进导出文档，
 * 且 <html> 标签带着当前 data-theme——所以这里同样可以直接引用 --code-*
 * 变量，浏览器打开导出文件时按普通 CSS 层叠解析，不需要为每个主题烘焙一份
 * 字面量颜色，天然对新主题免维护。
 *
 * 这里顺带修正了此前手工同步产生的三处偏移（读作静态渲染态 code-table.css
 * 的对应版本才是权威值）：
 * - tok-variableName.tok-definition/tok-variableName2 曾被误标成函数紫色，
 *   实际语义就是变量名，改回变量色
 * - 深色 tok-comment/tok-meta 曾用一个独立的 #7f848e，未跟随其余两处的
 *   #5c6370
 * - tok-inserted/tok-deleted 曾借用 property 青色，现在使用专门的
 *   diff-added/diff-removed 语义色
 */
export const EXPORT_CODE_STYLES = `
.milkdown .ProseMirror pre.xmd-export-code{margin:.3em 0 1em;padding:14px 16px;overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--code-card-bg);color:var(--code-text);font-family:'SFMono-Regular','SF Mono','JetBrains Mono',Menlo,Consolas,'Liberation Mono',monospace;font-size:13.5px;line-height:1.6;tab-size:2;white-space:pre}
.milkdown .ProseMirror .xmd-export-code code{display:block;padding:0;background:transparent;color:inherit!important;font:inherit;white-space:inherit}
.xmd-export-code .tok-keyword{color:var(--code-keyword)}
.xmd-export-code .tok-invalid{color:var(--code-invalid)}
.xmd-export-code .tok-string,.xmd-export-code .tok-string2,.xmd-export-code .tok-url{color:var(--code-string)}
.xmd-export-code .tok-comment{color:var(--code-comment);font-style:italic}
.xmd-export-code .tok-meta{color:var(--code-meta)}
.xmd-export-code .tok-number,.xmd-export-code .tok-bool,.xmd-export-code .tok-atom,.xmd-export-code .tok-literal,.xmd-export-code .tok-attributeName,.xmd-export-code .tok-labelName{color:var(--code-number)}
.xmd-export-code .tok-variableName,.xmd-export-code .tok-variableName2,.xmd-export-code .tok-variableName.tok-definition{color:var(--code-variable)}
.xmd-export-code .tok-propertyName{color:var(--code-property)}
.xmd-export-code .tok-typeName,.xmd-export-code .tok-className,.xmd-export-code .tok-namespace{color:var(--code-type)}
.xmd-export-code .tok-macroName,.xmd-export-code .tok-propertyName.tok-function,.xmd-export-code .tok-variableName.tok-function{color:var(--code-function)}
.xmd-export-code .tok-operator,.xmd-export-code .tok-punctuation{color:var(--code-operator)}
.xmd-export-code .tok-tagName{color:var(--code-tag)}
.xmd-export-code .tok-link,.xmd-export-code .tok-url{text-decoration:underline;color:var(--code-link)}
.xmd-export-code .tok-heading,.xmd-export-code .tok-strong{font-weight:600}
.xmd-export-code .tok-emphasis{font-style:italic}
.xmd-export-code .tok-inserted{color:var(--code-diff-added);background:color-mix(in srgb,var(--code-diff-added) 10%,transparent)}
.xmd-export-code .tok-deleted{text-decoration:line-through;color:var(--code-diff-removed);background:color-mix(in srgb,var(--code-diff-removed) 10%,transparent)}
`

function languageName(language: string): string {
  const normalized = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

/** Render code with stable, named token classes instead of CodeMirror's runtime-generated classes. */
export async function highlightCodeForExport(code: string, language: string): Promise<string> {
  const name = languageName(language)
  if (PLAIN_TEXT_LANGUAGES.has(name)) return escapeHtmlText(code)
  const description = name ? LanguageDescription.matchLanguageName(languages, name, false) : null
  if (!description) return escapeHtmlText(code)

  try {
    const support = await description.load()
    let html = ''
    highlightCode(
      code,
      support.language.parser.parse(code),
      classHighlighter,
      (text, classes) => {
        const escaped = escapeHtmlText(text)
        html += classes ? `<span class="${escapeHtmlText(classes)}">${escaped}</span>` : escaped
      },
      () => {
        html += '\n'
      },
    )
    return html
  } catch {
    return escapeHtmlText(code)
  }
}
