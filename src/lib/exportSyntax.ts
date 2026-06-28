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

export const EXPORT_CODE_STYLES = `
.milkdown .ProseMirror pre.xmd-export-code{margin:.3em 0 1em;padding:14px 16px;overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--bg-sidebar);color:#24292f;font-family:'SFMono-Regular','SF Mono','JetBrains Mono',Menlo,Consolas,'Liberation Mono',monospace;font-size:13.5px;line-height:1.6;tab-size:2;white-space:pre}
.milkdown .ProseMirror .xmd-export-code code{display:block;padding:0;background:transparent;color:inherit!important;font:inherit;white-space:inherit}
.xmd-export-code .tok-keyword,.xmd-export-code .tok-invalid{color:#cf222e}
.xmd-export-code .tok-string,.xmd-export-code .tok-string2,.xmd-export-code .tok-url{color:#0a3069}
.xmd-export-code .tok-comment,.xmd-export-code .tok-meta{color:#6e7781;font-style:italic}
.xmd-export-code .tok-number,.xmd-export-code .tok-bool,.xmd-export-code .tok-atom,.xmd-export-code .tok-literal{color:#0550ae}
.xmd-export-code .tok-variableName.tok-definition,.xmd-export-code .tok-variableName2{color:#8250df}
.xmd-export-code .tok-typeName,.xmd-export-code .tok-className,.xmd-export-code .tok-namespace,.xmd-export-code .tok-macroName{color:#953800}
.xmd-export-code .tok-propertyName,.xmd-export-code .tok-labelName,.xmd-export-code .tok-inserted{color:#116329}
.xmd-export-code .tok-variableName{color:#24292f}
.xmd-export-code .tok-operator,.xmd-export-code .tok-punctuation{color:#57606a}
.xmd-export-code .tok-link{text-decoration:underline;color:#0969da}
.xmd-export-code .tok-heading,.xmd-export-code .tok-strong{font-weight:600}
.xmd-export-code .tok-emphasis{font-style:italic}
.xmd-export-code .tok-deleted{text-decoration:line-through;color:#cf222e}
[data-theme='dark'] .milkdown .ProseMirror pre.xmd-export-code{color:#abb2bf;background:#282c34;border-color:var(--border-strong)}
[data-theme='dark'] .xmd-export-code .tok-keyword,[data-theme='dark'] .xmd-export-code .tok-invalid{color:#c678dd}
[data-theme='dark'] .xmd-export-code .tok-string,[data-theme='dark'] .xmd-export-code .tok-string2,[data-theme='dark'] .xmd-export-code .tok-url{color:#98c379}
[data-theme='dark'] .xmd-export-code .tok-comment,[data-theme='dark'] .xmd-export-code .tok-meta{color:#7f848e}
[data-theme='dark'] .xmd-export-code .tok-number,[data-theme='dark'] .xmd-export-code .tok-bool,[data-theme='dark'] .xmd-export-code .tok-atom,[data-theme='dark'] .xmd-export-code .tok-literal{color:#d19a66}
[data-theme='dark'] .xmd-export-code .tok-variableName.tok-definition,[data-theme='dark'] .xmd-export-code .tok-variableName2{color:#61afef}
[data-theme='dark'] .xmd-export-code .tok-typeName,[data-theme='dark'] .xmd-export-code .tok-className,[data-theme='dark'] .xmd-export-code .tok-namespace,[data-theme='dark'] .xmd-export-code .tok-macroName{color:#e5c07b}
[data-theme='dark'] .xmd-export-code .tok-propertyName,[data-theme='dark'] .xmd-export-code .tok-labelName,[data-theme='dark'] .xmd-export-code .tok-inserted{color:#56b6c2}
[data-theme='dark'] .xmd-export-code .tok-variableName{color:#abb2bf}
[data-theme='dark'] .xmd-export-code .tok-operator,[data-theme='dark'] .xmd-export-code .tok-punctuation{color:#abb2bf}
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
