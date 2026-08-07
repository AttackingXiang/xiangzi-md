import { matchKnownCodeLanguage } from './codeBlockLanguage'
import type { DetectedCodeLanguage } from './codeLanguageDetection'

export interface ClipboardLanguageSources {
  /** The `text/html` clipboard flavour. */
  html?: string | null
  /** The `vscode-editor-data` flavour VS Code and its forks put on the clipboard. */
  editorData?: string | null
}

/** Editor mode ids and shorthands that language-data does not know as aliases. */
const extraAliases = new Map([
  ['shellscript', 'shell'],
  ['zsh', 'shell'],
  ['javascriptreact', 'jsx'],
  ['typescriptreact', 'tsx'],
  ['objectivec', 'objective-c'],
  ['golang', 'go'],
  ['jsonc', 'json'],
  ['md', 'markdown'],
  ['docker', 'dockerfile'],
  ['htm', 'html'],
  ['py', 'python'],
  ['python3', 'python'],
  ['rs', 'rust'],
  ['kt', 'kotlin'],
  ['ps1', 'powershell'],
  ['proto', 'protobuf'],
  ['patch', 'diff'],
])

/**
 * Names that mean "no language". Highlighters emit these for unlabelled blocks, and
 * honouring them would tag a snippet with something worse than nothing.
 */
const ignoredNames = new Set([
  'plaintext',
  'plain',
  'text',
  'txt',
  'none',
  'nohighlight',
  'code',
  'snippet',
  'output',
  'console',
  'terminal',
  'example',
  'undefined',
  'null',
  'auto',
])

function resolveName(raw: string): DetectedCodeLanguage | null {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:language|lang|source|text|highlight)-/, '')
  if (!name || ignoredNames.has(name)) return null
  return matchKnownCodeLanguage(extraAliases.get(name) ?? name)
}

/**
 * Where the language hides in a copied fragment, most trustworthy first. These cover
 * Prism and highlight.js (`language-x` / `lang-x` / `hljs x`), GitHub's blob view and
 * rendered Markdown, and `<pre lang>`.
 */
const htmlHintPatterns: readonly RegExp[] = [
  /\bdata-(?:lang|language|tagsearch-lang|code-lang)\s*=\s*["']([\w#+.-]+)["']/i,
  /\bclass\s*=\s*["'][^"']*\b(?:language|lang)-([\w#+.-]+)/i,
  /\bclass\s*=\s*["'][^"']*\bhighlight-source-([\w#+.-]+)/i,
  /<pre\b[^>]*\blang\s*=\s*["']([\w#+.-]+)["']/i,
  /\bclass\s*=\s*["'][^"']*\bhljs\s+([\w#+.-]+)/i,
]

function fromEditorData(editorData: string): DetectedCodeLanguage | null {
  try {
    const parsed: unknown = JSON.parse(editorData)
    const mode = (parsed as { mode?: unknown } | null)?.mode
    return typeof mode === 'string' ? resolveName(mode) : null
  } catch {
    return null
  }
}

/**
 * Read the language the source application already knew, instead of guessing it back
 * from the characters. Copying out of VS Code, GitHub, MDN or any Prism/highlight.js
 * page carries the language in a clipboard flavour we otherwise throw away, and that
 * beats every heuristic. Returns null when the clipboard says nothing useful, leaving
 * the content-based detector to have a go.
 */
export function detectClipboardCodeLanguage(
  sources: ClipboardLanguageSources,
): DetectedCodeLanguage | null {
  if (sources.editorData) {
    const fromEditor = fromEditorData(sources.editorData)
    if (fromEditor) return fromEditor
  }
  const html = sources.html
  if (!html) return null
  for (const pattern of htmlHintPatterns) {
    const matched = html.match(pattern)
    const language = matched ? resolveName(matched[1]) : null
    if (language) return language
  }
  return null
}
