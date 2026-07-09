import { useCallback, useState } from 'react'
import { tagKey } from './frontmatter'

/**
 * 标签导航拆成两个互相独立的维度，避免「点标签既换左栏又出结果列」那种绕：
 * - selectedTag：驱动中间「结果列」（某标签下的文档）。
 * - overviewOpen：驱动左侧是否展示「全部标签」树（否则左侧仍是文件树）。
 * 默认点正文里的标签只出结果列、左侧不变；要浏览全部标签再显式打开树。
 */
export function useTagNavigation() {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)

  const openTag = useCallback((tag: string, openOverview = false): void => {
    setSelectedTag(tagKey(tag))
    if (openOverview) setOverviewOpen(true)
  }, [])

  const showOverview = useCallback((): void => setOverviewOpen(true), [])
  const hideOverview = useCallback((): void => setOverviewOpen(false), [])
  const closeResults = useCallback((): void => setSelectedTag(null), [])
  const reset = useCallback((): void => {
    setSelectedTag(null)
    setOverviewOpen(false)
  }, [])

  return { selectedTag, overviewOpen, openTag, showOverview, hideOverview, closeResults, reset }
}
