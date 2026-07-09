import { useCallback, useState } from 'react'
import { tagKey } from './frontmatter'
import type { TagSidebarMode } from './types'

export function useTagNavigation() {
  const [mode, setMode] = useState<TagSidebarMode>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const openTag = useCallback((tag: string): void => {
    setSelectedTag(tagKey(tag))
    setMode('related')
  }, [])

  const showTags = useCallback((): void => {
    setSelectedTag(null)
    setMode('tags')
  }, [])

  const closeTags = useCallback((): void => {
    setSelectedTag(null)
    setMode(null)
  }, [])

  return { mode, selectedTag, openTag, showTags, closeTags }
}
