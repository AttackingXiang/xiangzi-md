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

export function outlineHasChildren(items: readonly OutlineItem[], index: number): boolean {
  return (
    index + 1 < items.length &&
    (items[index + 1]?.level ?? 0) > (items[index]?.level ?? Number.POSITIVE_INFINITY)
  )
}

export function outlineDescendantEnd(items: readonly OutlineItem[], index: number): number {
  const level = items[index]?.level ?? Number.POSITIVE_INFINITY
  let end = index + 1
  while (end < items.length && (items[end]?.level ?? 0) > level) end += 1
  return end
}

/** 返回折叠状态下仍应渲染的标题下标；跳级标题也归最近的低级标题管理。 */
export function visibleOutlineIndices(
  items: readonly OutlineItem[],
  collapsed: ReadonlySet<number>,
): number[] {
  const visible: number[] = []
  let hiddenBelowLevel: number | null = null
  for (let index = 0; index < items.length; index += 1) {
    const level = items[index]?.level ?? 1
    if (hiddenBelowLevel !== null && level > hiddenBelowLevel) continue
    hiddenBelowLevel = null
    visible.push(index)
    if (collapsed.has(index)) hiddenBelowLevel = level
  }
  return visible
}
