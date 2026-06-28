const UPDATE_SECTION = /^(?:#{1,6}\s*)?(?:本次更新|what(?:'|’)s new)$/i
const HEADING = /^#{1,6}\s+/
const BULLET = /^[-*+]\s+(.+)$/

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .trim()
}

/** 只展示发布说明中明确面向用户的“本次更新”列表。 */
export function extractUpdateHighlights(notes?: string): string[] {
  if (!notes) return []

  const lines = notes.split(/\r?\n/).map((line) => line.trim())
  const sectionStart = lines.findIndex((line) => UPDATE_SECTION.test(line))
  if (sectionStart < 0) return []

  const highlights: string[] = []
  for (const line of lines.slice(sectionStart + 1)) {
    if (HEADING.test(line)) break
    const match = line.match(BULLET)
    if (!match) continue
    const item = cleanInlineMarkdown(match[1])
    if (item && !highlights.includes(item)) highlights.push(item)
    if (highlights.length === 8) break
  }

  return highlights
}
