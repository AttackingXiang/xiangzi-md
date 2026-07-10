import type { Extension } from '@codemirror/state'
import { fileExtension } from './fileKind'

/**
 * 扩展名 → CodeMirror 语言支持的映射。所有语言包都动态 import()，只有真正打开
 * 对应格式时才把这段语法包拉进来，避免把全部语言塞进首屏。plainText（.txt/.log/
 * 无扩展名）不需要任何语言包，返回 null 即可。
 */
export interface TextLanguage {
  /** 状态栏展示名 */
  label: string
  /** 该语言是否提供代码折叠范围（决定是否显示「折叠/展开全部」按钮）。
   * 只有带 foldNodeProp 的语法（JSON/JS/TS/CSS/HTML/XML/YAML）才有意义；
   * StreamLanguage（TOML/INI/Shell）与 SQL、纯文本没有折叠结构。 */
  foldable: boolean
  /** 动态加载 CodeMirror 语言扩展 */
  load: () => Promise<Extension>
}

const json = (): TextLanguage => ({
  label: 'JSON',
  foldable: true,
  load: async () => (await import('@codemirror/lang-json')).json(),
})

const javascript = (
  label: string,
  opts: { typescript?: boolean; jsx?: boolean },
): TextLanguage => ({
  label,
  foldable: true,
  load: async () => (await import('@codemirror/lang-javascript')).javascript(opts),
})

const legacy = (
  label: string,
  mode: () => Promise<{ [k: string]: unknown }>,
  key: string,
): TextLanguage => ({
  label,
  foldable: false,
  load: async () => {
    const { StreamLanguage } = await import('@codemirror/language')
    const mod = await mode()
    return StreamLanguage.define(mod[key] as never)
  },
})

/** 扩展名（小写、不含点）→ 语言工厂 */
const BY_EXT: Record<string, () => TextLanguage> = {
  json,
  json5: json,
  jsonc: json,
  js: () => javascript('JavaScript', { jsx: true }),
  mjs: () => javascript('JavaScript', {}),
  cjs: () => javascript('JavaScript', {}),
  jsx: () => javascript('JSX', { jsx: true }),
  ts: () => javascript('TypeScript', { typescript: true }),
  mts: () => javascript('TypeScript', { typescript: true }),
  cts: () => javascript('TypeScript', { typescript: true }),
  tsx: () => javascript('TSX', { typescript: true, jsx: true }),
  css: () => ({
    label: 'CSS',
    foldable: true,
    load: async () => (await import('@codemirror/lang-css')).css(),
  }),
  html: () => ({
    label: 'HTML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-html')).html(),
  }),
  htm: () => ({
    label: 'HTML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-html')).html(),
  }),
  xml: () => ({
    label: 'XML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  }),
  svg: () => ({
    label: 'XML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  }),
  yaml: () => ({
    label: 'YAML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  }),
  yml: () => ({
    label: 'YAML',
    foldable: true,
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  }),
  sql: () => ({
    label: 'SQL',
    foldable: false,
    load: async () => (await import('@codemirror/lang-sql')).sql(),
  }),
  toml: () => legacy('TOML', () => import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  ini: () => legacy('INI', () => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  conf: () => legacy('INI', () => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  properties: () =>
    legacy('INI', () => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  sh: () => legacy('Shell', () => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  bash: () => legacy('Shell', () => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  zsh: () => legacy('Shell', () => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
}

/** 按文件名解析语言支持；纯文本返回 null。 */
export function resolveTextLanguage(name: string): TextLanguage | null {
  const factory = BY_EXT[fileExtension(name)]
  return factory ? factory() : null
}

/** 状态栏展示的语言名（纯文本回退到 Plain Text）。 */
export function textLanguageLabel(name: string): string {
  return resolveTextLanguage(name)?.label ?? 'Plain Text'
}

/** 该文件是否为 JSON 家族（决定是否显示格式化/压缩按钮）。 */
export function isJsonFile(name: string): boolean {
  return ['json', 'json5', 'jsonc'].includes(fileExtension(name))
}

/** 该文件的语言是否支持折叠（决定是否显示「折叠/展开全部」按钮）。 */
export function isFoldableFile(name: string): boolean {
  return resolveTextLanguage(name)?.foldable ?? false
}
