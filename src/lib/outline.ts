import type { OutlineItem } from '../types'

/** 从 Markdown 解析标题大纲（跳过代码块内的 #） */
export function parseOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = markdown.split('\n')
  let inFence = false
  let index = 0
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (m) {
      items.push({ level: m[1].length, text: m[2].trim(), index })
      index++
    }
  }
  return items
}
