import { normalizeTag, parseMarkdownFrontmatter, setFrontmatterTags, tagKey } from './frontmatter'

// 行内 #标签（跟 frontmatter.ts 里的 INLINE_TAG_RE 保持一致）：# 前是行首或空白，
// # 后紧跟标签字符。捕获组不含开头的 #。
const INLINE_TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gmu
// 代码围栏 / 行内代码：改写行内标签时整段跳过，避免动到 shebang、C 的 #include 等。
const CODE_SPAN_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g

/**
 * 把一个标签「按前缀改名/移动」后得到的新标签字符串；不在该子树内则返回 null。
 *
 * 段级前缀匹配：fromKey='test' 命中 test、test/wap，但不命中 testx。命中后把
 * 匹配到的前缀整段换成 toTag，保留原标签剩下的层级与大小写。例如
 * renamedTag('Test/Wap', 'test', 'project/test') === 'project/test/Wap'。
 */
export function renamedTag(originalTag: string, fromKey: string, toTag: string): string | null {
  const fromSegments = fromKey.split('/').filter(Boolean)
  if (fromSegments.length === 0) return null
  const originalKeySegments = tagKey(originalTag).split('/')
  if (originalKeySegments.length < fromSegments.length) return null
  if (originalKeySegments.slice(0, fromSegments.length).join('/') !== fromKey) return null
  const originalSegments = normalizeTag(originalTag).split('/')
  const rest = originalSegments.slice(fromSegments.length)
  return [toTag, ...rest].join('/')
}

function rewriteInlineTagsOutsideCode(body: string, fromKey: string, toTag: string): string {
  const rewriteText = (text: string): string =>
    text.replace(INLINE_TAG_RE, (match, prefix: string, tag: string) => {
      const next = renamedTag(tag, fromKey, toTag)
      return next ? `${prefix}#${next}` : match
    })

  let result = ''
  let last = 0
  for (const code of body.matchAll(CODE_SPAN_RE)) {
    const index = code.index ?? 0
    result += rewriteText(body.slice(last, index))
    result += code[0] // 代码段原样保留
    last = index + code[0].length
  }
  result += rewriteText(body.slice(last))
  return result
}

/**
 * 在单篇 Markdown 里把标签 fromKey（及其整棵子树）改名/移动成 toTag 前缀，
 * 同时覆盖 frontmatter 标签与正文行内 #标签。返回改写后的文本；若这篇根本
 * 没命中该标签，返回的内容跟原文一致（changed=false）。
 */
export function renameTagInMarkdown(
  markdown: string,
  fromKey: string,
  toTag: string,
): { changed: boolean; content: string } {
  const parsed = parseMarkdownFrontmatter(markdown)

  // frontmatter 标签：逐个套用改名规则；有命中才重写 tags 块。
  let content = markdown
  let changed = false
  if (parsed.tags.length > 0) {
    let hit = false
    const nextTags = parsed.tags.map((tag) => {
      const next = renamedTag(tag, fromKey, toTag)
      if (next === null) return tag
      hit = true
      return next
    })
    if (hit) {
      content = setFrontmatterTags(content, nextTags)
      changed = true
    }
  }

  // 正文行内 #标签（跳过代码段）。基于最新 content 重新取 body 改写。
  const reparsed = parseMarkdownFrontmatter(content)
  const newBody = rewriteInlineTagsOutsideCode(reparsed.body, fromKey, toTag)
  if (newBody !== reparsed.body) {
    content =
      reparsed.raw === null
        ? newBody
        : content.slice(0, content.length - reparsed.body.length) + newBody
    changed = true
  }

  return { changed, content }
}

export interface TagRenameFileIO {
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
}

/** 逐个文件套用标签改名：读 → 改写 → 只在真的变了才写回。返回改了几个 / 失败几个，
 * 便于把结果反馈给用户。纯逻辑（IO 通过参数注入），方便测试批量循环本身。 */
export async function renameTagInFiles(
  paths: readonly string[],
  fromKey: string,
  toTag: string,
  io: TagRenameFileIO,
): Promise<{ changed: number; failed: number }> {
  let changed = 0
  let failed = 0
  for (const path of paths) {
    try {
      const original = await io.read(path)
      const { changed: hit, content } = renameTagInMarkdown(original, fromKey, toTag)
      if (hit) {
        await io.write(path, content)
        changed += 1
      }
    } catch {
      failed += 1
    }
  }
  return { changed, failed }
}

/** 把「drop 拖动源到目标下」翻译成 toTag：目标完整路径 + 拖动源的叶子段。
 * 例如把 a/b 拖到 c 下 -> c/b；把 test 拖到 project 下 -> project/test。 */
export function moveTagUnderTarget(dragKey: string, targetFullLabel: string): string {
  const leaf = dragKey.split('/').filter(Boolean).pop() ?? dragKey
  return `${targetFullLabel}/${leaf}`
}
