import { parse, stringify } from 'yaml'
import { normalizeTag, parseMarkdownFrontmatter } from './frontmatter'

/** frontmatter 属性的展示/编辑类型。跟 Obsidian 的属性类型一一对应：
 * text（文本）、list（多值列表，标签/别名都是它）、number（数字）、
 * checkbox（布尔）、date（日期）、datetime（日期时间）。 */
export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime'

export interface DocumentProperty {
  key: string
  type: PropertyType
  /** 按 type 归一化后的值：list -> string[]；number -> number|null；
   * checkbox -> boolean；其余 -> string|null（空值统一为 null）。 */
  value: string | string[] | number | boolean | null
  /** 面板建模不了的复杂值（嵌套映射、映射列表等）：原样保存在这里、只读展示，
   * 写回时原封不动透传，绝不因为一次别处的编辑把它清空/破坏。 */
  complex?: boolean
  raw?: unknown
}

/** 名字暗示语义、应当强制成 list 的键（大小写不敏感）。Obsidian 里 tags 和
 * aliases 天生就是多值属性，哪怕文件里只写了一个标量值也按列表编辑。 */
const LIST_KEY_RE = /^(?:tags?|aliases?|cssclasses?)$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?/

function isSimpleScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function isSimpleArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSimpleScalar)
}

function inferType(key: string, value: unknown): PropertyType {
  if (LIST_KEY_RE.test(key) || Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return 'date'
    if (DATETIME_RE.test(value)) return 'datetime'
  }
  return 'text'
}

function toStringItem(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // null/undefined 和罕见的嵌套结构（frontmatter 列表项极少是映射）一律当空值
  return ''
}

function normalizeValue(type: PropertyType, value: unknown): DocumentProperty['value'] {
  switch (type) {
    case 'list':
      if (Array.isArray(value)) return value.map(toStringItem).filter((item) => item.length > 0)
      // 单标量当作列表首项（tags: foo 这种简写）。
      return value === null || value === undefined || value === '' ? [] : [toStringItem(value)]
    case 'number':
      return typeof value === 'number' ? value : null
    case 'checkbox':
      return Boolean(value)
    default:
      return value === null || value === undefined || value === '' ? null : toStringItem(value)
  }
}

/** 把某个值强制转换到目标类型——用户在面板上手动切换属性类型时调用，尽量
 * 保留原值的信息（列表↔文本互转、数字解析等）。 */
export function coerceValue(
  value: DocumentProperty['value'],
  type: PropertyType,
): DocumentProperty['value'] {
  switch (type) {
    case 'list':
      if (Array.isArray(value)) return value
      if (value === null || value === '' || value === undefined) return []
      return [toStringItem(value)]
    case 'number': {
      if (typeof value === 'number') return value
      const parsed = Number(Array.isArray(value) ? value[0] : value)
      return Number.isFinite(parsed) && String(value).trim() !== '' ? parsed : null
    }
    case 'checkbox':
      return Boolean(Array.isArray(value) ? value.length : value)
    default:
      if (Array.isArray(value)) return value.join(', ') || null
      if (value === null || value === undefined || value === '') return null
      return toStringItem(value)
  }
}

/** 解析 frontmatter 的原始 YAML 文本，得到有序的属性列表。顶层不是映射
 * （纯标量/序列）或解析失败时返回空列表——这类内容按"没有可编辑属性"处理，
 * 保持原文不动。 */
export function parseFrontmatterProperties(raw: string | null): DocumentProperty[] {
  if (!raw || !raw.trim()) return []
  let doc: unknown
  try {
    doc = parse(raw)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return []
  const props: DocumentProperty[] = []
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (isSimpleScalar(value) || isSimpleArray(value)) {
      const type = inferType(key, value)
      props.push({ key, type, value: normalizeValue(type, value) })
    } else {
      // 嵌套映射 / 映射列表等复杂结构：面板编辑不了，原样保留、只读展示。
      props.push({ key, type: 'text', value: null, complex: true, raw: value })
    }
  }
  return props
}

export function propertiesFromMarkdown(markdown: string): DocumentProperty[] {
  return parseFrontmatterProperties(parseMarkdownFrontmatter(markdown).raw)
}

function toYamlValue(prop: DocumentProperty): unknown {
  if (prop.complex) return prop.raw
  switch (prop.type) {
    case 'list':
      return (Array.isArray(prop.value) ? prop.value : [])
        .map((item) => normalizeTag(toStringItem(item)))
        .filter((item) => item.length > 0)
    case 'number':
      return typeof prop.value === 'number' ? prop.value : null
    case 'checkbox':
      return Boolean(prop.value)
    default: {
      const text = toStringItem(prop.value)
      return text.length > 0 ? text : null
    }
  }
}

/** 把属性列表序列化成 frontmatter 的 YAML 主体（不含首尾的 `---`）。空 key 的
 * 属性会被跳过（新建但还没命名的行不落盘）。用 yaml 库统一输出块状序列、必要时
 * 才加引号、空值渲染成空——跟 Obsidian 写出来的 frontmatter 基本一致。 */
export function serializeProperties(properties: DocumentProperty[]): string {
  const map = new Map<string, unknown>()
  for (const prop of properties) {
    const key = prop.key.trim()
    if (!key || map.has(key)) continue
    map.set(key, toYamlValue(prop))
  }
  if (map.size === 0) return ''
  return stringify(Object.fromEntries(map), { nullStr: '', lineWidth: 0 }).replace(/\n+$/, '')
}

/** 用新的属性列表重写整篇 Markdown 的 frontmatter，正文保持不变。属性全部删空
 * 时会连同 `---` 分隔块一起移除。 */
export function setFrontmatterProperties(markdown: string, properties: DocumentProperty[]): string {
  const parsed = parseMarkdownFrontmatter(markdown)
  const body = parsed.raw === null ? markdown.replace(/^\uFEFF/, '') : parsed.body
  const yaml = serializeProperties(properties)
  if (!yaml) return body
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const yamlLines = yaml.split('\n').join(newline)
  return `---${newline}${yamlLines}${newline}---${newline}${body}`
}

const TYPE_LABELS: Record<PropertyType, string> = {
  text: '文本',
  list: '列表',
  number: '数字',
  checkbox: '复选框',
  date: '日期',
  datetime: '日期与时间',
}

export function propertyTypeLabel(type: PropertyType): string {
  return TYPE_LABELS[type]
}

export const PROPERTY_TYPES: PropertyType[] = [
  'text',
  'list',
  'number',
  'checkbox',
  'date',
  'datetime',
]
