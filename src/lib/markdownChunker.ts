/**
 * 大文档分块器：把一份 Markdown 拆成若干「块」，供渐进式渲染逐块解析并追加到
 * 编辑器中。拆分只允许发生在「不在围栏代码块内的空行」处——这样每一块都是一
 * 组完整的顶层块（段落/标题/列表/代码块/表格等），单独解析不会破坏内容。
 *
 * 不变式（round-trip）：splitMarkdownIntoChunks(md, n).join('\n') === md 恒成立。
 * 实现方式是先用 md.split('\n') 切成行，把每一行原样分配到唯一一个 chunk 中、
 * 按原顺序拼接；因此只要不丢行、不加行，拼接必然还原原文，不变式天然成立。
 */
export function splitMarkdownIntoChunks(markdown: string, targetChunkBytes: number): string[] {
  if (markdown === '') return ['']
  if (markdown.length < targetChunkBytes) return [markdown]

  const lines = markdown.split('\n')
  const chunks: string[] = []
  let current: string[] = []
  let currentLength = 0

  // 围栏代码块状态：null 表示不在围栏内；否则记录围栏字符与最少长度。
  let fenceChar: '`' | '~' | null = null
  let fenceLen = 0

  for (const line of lines) {
    current.push(line)
    currentLength += line.length + 1 // 近似算上被 join 吃掉的换行符

    const trimmed = line.trimStart()
    const match = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceChar === null) {
      if (match) {
        fenceChar = match[1][0] as '`' | '~'
        fenceLen = match[1].length
      }
    } else {
      // 收尾行：同种围栏字符、长度不小于开头，且收尾行本身不带 info string。
      if (
        match &&
        match[1][0] === fenceChar &&
        match[1].length >= fenceLen &&
        trimmed.slice(match[1].length).trim() === ''
      ) {
        fenceChar = null
        fenceLen = 0
      }
    }

    const isBlank = trimmed === ''
    const canBreakHere = isBlank && fenceChar === null
    if (canBreakHere && currentLength >= targetChunkBytes) {
      chunks.push(current.join('\n'))
      current = []
      currentLength = 0
    }
  }

  if (current.length > 0) {
    chunks.push(current.join('\n'))
  }

  return chunks.length > 0 ? chunks : ['']
}
