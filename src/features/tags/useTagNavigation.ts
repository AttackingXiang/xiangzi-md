import { useCallback, useState } from 'react'
import { tagKey } from './frontmatter'

/**
 * 中间「结果列」选中的标签。
 *
 * 左栏展示什么（文件树 / 搜索 / 标签树）已经由 App 的 sidebarMode 统一管，不再有
 * 这里曾经的 overviewOpen——那会儿两个布尔量各管一半，谁覆盖谁全看调用顺序。
 * 现在这个 hook 只剩一个维度：选中的标签驱动结果列，和左栏是哪个模式无关。
 */
export function useTagNavigation() {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const openTag = useCallback((tag: string): void => setSelectedTag(tagKey(tag)), [])
  const closeResults = useCallback((): void => setSelectedTag(null), [])
  const reset = useCallback((): void => setSelectedTag(null), [])

  return { selectedTag, openTag, closeResults, reset }
}
