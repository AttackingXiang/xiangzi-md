import type { OutlineItem } from '../types'
import { markdownHeadingIndex } from './linkNavigation'

/** 从统一的 CommonMark 标题模型构建大纲。 */
export function parseOutline(markdown: string): OutlineItem[] {
  return markdownHeadingIndex(markdown, { topLevelOnly: true }).map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    offset: heading.offset,
    index,
  }))
}
