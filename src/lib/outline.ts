import type { OutlineItem } from '../types'

/** 从 Markdown 解析标题大纲（跳过代码块内的 #，支持 ATX 和 setext 两种标题语法） */
export function parseOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = markdown.split('\n')
  let inFence = false
  let index = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // ATX headings: # Heading
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (m) {
      items.push({ level: m[1].length, text: m[2].trim(), index })
      index++
      continue
    }

    // Setext headings: non-empty line followed by === or ---
    if (line.trim() && i + 1 < lines.length) {
      const next = lines[i + 1]
      if (/^={1,}\s*$/.test(next)) {
        items.push({ level: 1, text: line.trim(), index })
        index++
        i++ // skip the underline row
        continue
      }
      if (/^-{1,}\s*$/.test(next)) {
        items.push({ level: 2, text: line.trim(), index })
        index++
        i++ // skip the underline row
        continue
      }
    }
  }
  return items
}
