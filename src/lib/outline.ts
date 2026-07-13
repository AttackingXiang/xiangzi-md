import type { OutlineItem } from '../types'
import { markdownHeadings } from './linkNavigation'

/** 从统一的 CommonMark 标题模型构建大纲。 */
export function parseOutline(markdown: string): OutlineItem[] {
  return markdownHeadings(markdown, { topLevelOnly: true }).map((heading, index) => ({
    ...heading,
    index,
  }))
}
