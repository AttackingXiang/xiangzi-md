/**
 * Canonical frontend manifest for document formats. Dialog filters, file-tree
 * settings and editor routing must derive from this file instead of carrying
 * independent extension lists.
 */
export interface TextFormatGroup {
  id: string
  label: string
  labelEn: string
  extensions: readonly string[]
}

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mdx'] as const

export const TEXT_FORMAT_GROUPS: readonly TextFormatGroup[] = [
  { id: 'plaintext', label: '纯文本', labelEn: 'Plain text', extensions: ['txt', 'log'] },
  { id: 'json', label: 'JSON', labelEn: 'JSON', extensions: ['json', 'json5', 'jsonc'] },
  { id: 'yaml', label: 'YAML', labelEn: 'YAML', extensions: ['yaml', 'yml'] },
  { id: 'toml', label: 'TOML', labelEn: 'TOML', extensions: ['toml'] },
  {
    id: 'ini',
    label: 'INI / Conf',
    labelEn: 'INI / Conf',
    extensions: ['ini', 'conf', 'properties'],
  },
  { id: 'xml', label: 'XML / SVG', labelEn: 'XML / SVG', extensions: ['xml', 'svg'] },
  { id: 'html', label: 'HTML', labelEn: 'HTML', extensions: ['html', 'htm'] },
  { id: 'css', label: 'CSS', labelEn: 'CSS', extensions: ['css'] },
  {
    id: 'javascript',
    label: 'JavaScript',
    labelEn: 'JavaScript',
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    labelEn: 'TypeScript',
    extensions: ['ts', 'mts', 'cts', 'tsx'],
  },
  { id: 'sql', label: 'SQL', labelEn: 'SQL', extensions: ['sql'] },
  { id: 'shell', label: 'Shell', labelEn: 'Shell', extensions: ['sh', 'bash', 'zsh'] },
]

export const DEFAULT_VISIBLE_TEXT_EXTENSIONS = TEXT_FORMAT_GROUPS.flatMap((group) => [
  ...group.extensions,
])
export const KNOWN_TEXT_EXTENSIONS: ReadonlySet<string> = new Set(DEFAULT_VISIBLE_TEXT_EXTENSIONS)
export const OPENABLE_DOCUMENT_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  ...DEFAULT_VISIBLE_TEXT_EXTENSIONS,
]

/** Lowercase extension without the dot. Dotfiles and extensionless names return empty. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isMarkdownFile(name: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(fileExtension(name))
}

export function isKnownTextFile(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name
  if (base.startsWith('.')) return false
  const extension = fileExtension(name)
  return extension === '' || isMarkdownFile(name) || KNOWN_TEXT_EXTENSIONS.has(extension)
}

/** Preserve a document's current type in Save As; extensionless files stay extensionless. */
export function saveDialogExtensions(name: string): readonly string[] {
  const extension = fileExtension(name)
  return extension ? [extension] : []
}
