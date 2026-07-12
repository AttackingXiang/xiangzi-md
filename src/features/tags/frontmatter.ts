import type { DocumentMeta } from './types'

const FRONTMATTER_RE = /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/

// 以下几个正则被 renameTag.ts / useTagIndex.ts 复用，在此单一定义、导出共享，
// 避免多处拷贝后悄悄漂移。它们都带 /g 标志，但仓库里只用 String.replace（每次
// 调用前 lastIndex 会被重置为 0）和 matchAll（内部会克隆正则、不共享 lastIndex）
// 消费，不存在跨调用的 lastIndex 残留问题；如果以后有人想用手写的 exec 循环，
// 记得这个前提不成立，要么换成局部的一次性正则，要么自己管理 lastIndex。
export const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown|mdown|mkd|mdx)$/i

export interface MarkdownFrontmatter {
  body: string
  raw: string | null
  tags: string[]
  /** frontmatter 里的 title 字段（如果有）。跟正文 H1 是两个独立概念——有些
   * 笔记（尤其从别的工具迁移过来的）只在 frontmatter 写了 title，正文没有
   * H1；这种情况下编辑器需要知道这个值，把它当标题展示出来。 */
  title: string | null
}

export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').trim()
}

export function tagKey(value: string): string {
  return normalizeTag(value).toLocaleLowerCase()
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return String(JSON.parse(trimmed))
      } catch {
        return trimmed.slice(1, -1)
      }
    }
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

/** 去掉未加引号的行内 YAML 注释（"# ..."），保留引号内的 '#' 原样。 */
function stripTrailingComment(value: string): string {
  let quote = ''
  let escaped = false
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
      continue
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trim()
    }
  }
  return value.trim()
}

function splitInlineList(value: string): string[] {
  const source = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  const result: string[] = []
  let current = ''
  let quote = ''
  let escaped = false
  for (const char of source) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote === '"') {
      current += char
      escaped = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
      current += char
      continue
    }
    if (char === ',' && !quote) {
      result.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) result.push(current)
  return result
}

function uniqueTags(values: string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of values) {
    const tag = normalizeTag(unquoteYaml(value))
    const key = tagKey(tag)
    if (!tag || !key || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

// "tags?" 同时兼容 Obsidian 认可的复数 tags: 和单数 tag: 两种键名。
const TAGS_KEY_RE = /^\s*tags?\s*:/i
const TAGS_KEY_PREFIX_RE = /^\s*tags?\s*:\s*/i

function parseTagsFromRaw(raw: string): string[] {
  const lines = raw.split(/\r?\n/)
  const index = lines.findIndex((line) => TAGS_KEY_RE.test(line))
  if (index < 0) return []
  const inline = stripTrailingComment(lines[index].replace(TAGS_KEY_PREFIX_RE, ''))
  if (inline) {
    return uniqueTags(
      inline.startsWith('[') && inline.endsWith(']') ? splitInlineList(inline) : [inline],
    )
  }

  const blockValues: string[] = []
  for (let current = index + 1; current < lines.length; current += 1) {
    const match = lines[current].match(/^\s*-\s*(.*?)\s*$/)
    if (!match) {
      if (!lines[current].trim()) continue
      break
    }
    blockValues.push(stripTrailingComment(match[1]))
  }
  return uniqueTags(blockValues)
}

const TITLE_KEY_RE = /^\s*title\s*:/i

function parseTitleFromRaw(raw: string): string | null {
  const line = raw.split(/\r?\n/).find((l) => TITLE_KEY_RE.test(l))
  if (!line) return null
  const value = stripTrailingComment(line.replace(/^\s*title\s*:\s*/i, ''))
  const title = unquoteYaml(value).trim()
  return title || null
}

/** 至少要有一行形如 "key: value" 的 YAML 映射，才当作 frontmatter 处理——否则
 * 文档开头一段被两条 "---" 分隔线夹住的引言/分隔符（同样匹配 FRONTMATTER_RE）
 * 会被误当成 frontmatter 整段隐藏，WYSIWYG 视图会跟源码模式显示的内容对不上。 */
function looksLikeYaml(raw: string): boolean {
  return raw.split(/\r?\n/).some((line) => /^[ \t]*[\w-]+[ \t]*:(?:\s|$)/.test(line))
}

export function parseMarkdownFrontmatter(markdown: string): MarkdownFrontmatter {
  const match = markdown.match(FRONTMATTER_RE)
  if (!match || !looksLikeYaml(match[1]))
    return { body: markdown, raw: null, tags: [], title: null }
  return {
    raw: match[1],
    body: markdown.slice(match[0].length),
    tags: parseTagsFromRaw(match[1]),
    title: parseTitleFromRaw(match[1]),
  }
}

/** 写入用 Obsidian 属性面板默认的块状列表格式（而不是单行内联数组）——两种格式
 * 读的时候都认（见 parseTagsFromRaw），但写的时候统一成这种，跟 Obsidian 自己
 * 写出来的笔记保持一致，减少两边交替编辑时的 diff。标签值仍然加引号：块状列表
 * 里的值本该不加引号，但标签输入框不禁止冒号之类的 YAML 特殊字符，不加引号在
 * 极端情况下会被解析成嵌套映射，损坏 frontmatter；加引号后 Obsidian 也一样能读。 */
function yamlTagList(tags: string[]): string[] {
  if (tags.length === 0) return ['tags: []']
  return ['tags:', ...tags.map((tag) => `  - ${JSON.stringify(normalizeTag(tag))}`)]
}

export function setFrontmatterTags(markdown: string, values: string[]): string {
  const tags = uniqueTags(values)
  const parsed = parseMarkdownFrontmatter(markdown)
  const tagLines = yamlTagList(tags)
  // 只用单个换行分隔，跟 FRONTMATTER_RE 实际消费的换行数一致（也跟下面
  // raw !== null 分支一致）——用两个换行会导致重新解析出的 body 比原文多一行
  // 空行，这个偏移会被写回磁盘、下次打开时在编辑器里多出一个空段落。
  if (parsed.raw === null)
    return `---\n${tagLines.join('\n')}\n---\n${markdown.replace(/^\uFEFF/, '')}`

  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = parsed.raw.split(/\r?\n/)
  const index = lines.findIndex((line) => TAGS_KEY_RE.test(line))
  if (index < 0) {
    lines.push(...tagLines)
  } else {
    let end = index + 1
    if (!lines[index].replace(TAGS_KEY_PREFIX_RE, '').trim()) {
      while (end < lines.length && (/^\s*-\s*/.test(lines[end]) || !lines[end].trim())) end += 1
    }
    lines.splice(index, end - index, ...tagLines)
  }
  return `---${newline}${lines.join(newline)}${newline}---${newline}${parsed.body}`
}

export function replaceMarkdownBody(markdown: string, body: string): string {
  const parsed = parseMarkdownFrontmatter(markdown)
  if (parsed.raw === null) return body
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  return `---${newline}${parsed.raw}${newline}---${newline}${body}`
}

// Obsidian 风格行内标签："#" 前面必须是行首或空白（排除 "foo#bar" 这种词中间的
// #），"#" 后面必须紧跟标签字符、不能有空格（排除标题 "# Title"）。捕获组本身
// 不含开头的 "#"。renameTag.ts 改写正文标签时复用同一份，保证识别规则一致。
export const INLINE_TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gmu

// 代码围栏 / 行内代码：三选一交替分支合并成一次 replace，比原来分三趟 replace
// （``` 再 ~~~ 再行内 `）少产生两份全文中间字符串。renameTag.ts 改写行内标签时
// 用它跳过代码段，跟这里扫描标签时跳过的范围保持一致。
export const CODE_SPAN_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g

function stripCodeForTagScan(body: string): string {
  return body.replace(CODE_SPAN_RE, '')
}

/** 抓取正文里手打的 #标签（跳过代码块/行内代码，避免把 shebang、C 的 #include
 * 这类内容误判成标签；纯数字如 #123 也排除，避免跟 issue 编号冲突）。 */
export function extractInlineTags(body: string): string[] {
  const scanned = stripCodeForTagScan(body)
  const found: string[] = []
  for (const match of scanned.matchAll(INLINE_TAG_RE)) {
    if (!/^\d+$/.test(match[2])) found.push(match[2])
  }
  return uniqueTags(found)
}

// 摘要只需要最终 120 字符，没必要对整篇正文（可能几十 MB）做 6 次全文
// replace——那样每次都会产生一份全文长度的中间字符串。这里先截出一段远超
// 120 字符上限的前缀（8192 字符足够覆盖开头的标题/加粗/链接等格式字符被剥掉
// 后仍然凑够 120 个可见字符的情况），后续的 replace 链只在这段有界前缀上跑。
const EXCERPT_SCAN_LIMIT = 8192

function boundedExcerptSource(body: string): string {
  if (body.length <= EXCERPT_SCAN_LIMIT) return body
  let prefix = body.slice(0, EXCERPT_SCAN_LIMIT)
  // 如果截断点恰好落在一个未闭合的 ``` 代码围栏内部（prefix 里 ``` 出现次数为
  // 奇数），后面的 replace 链里剥代码块的规则要求成对的 ```……```，缺一半就
  // 不会生效，围栏内的代码原文会原样漏进摘要。退回到最后一个 ``` 之前，
  // 让这段前缀里的围栏要么完整闭合、要么整个不出现，不去猜测围栏在哪结束。
  const fenceCount = prefix.split('```').length - 1
  if (fenceCount % 2 === 1) {
    const lastFenceIndex = prefix.lastIndexOf('```')
    prefix = prefix.slice(0, lastFenceIndex)
  }
  return prefix
}

function plainTextExcerpt(body: string): string {
  return boundedExcerptSource(body)
    .replace(/^\s*#{1,6}\s+.*$/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#|\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function documentMetaFromMarkdown(
  path: string,
  name: string,
  markdown: string,
  modifiedNanos: number,
): DocumentMeta {
  const parsed = parseMarkdownFrontmatter(markdown)
  const heading = parsed.body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]
  return {
    path,
    name,
    // 正文 H1 优先；没有 H1 但 frontmatter 写了 title 就用它；两者都没有才退回文件名。
    title:
      heading?.replace(/\s+#+\s*$/, '').trim() ||
      parsed.title ||
      name.replace(MARKDOWN_EXTENSION_RE, ''),
    excerpt: plainTextExcerpt(parsed.body),
    updatedAt: Math.floor(modifiedNanos / 1_000_000),
    // 标签索引（全部标签/相关文档）里，正文内联 #标签 跟 frontmatter 标签一视同仁。
    tags: uniqueTags([...parsed.tags, ...extractInlineTags(parsed.body)]),
  }
}
