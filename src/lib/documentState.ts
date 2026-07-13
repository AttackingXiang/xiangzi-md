import type { Tab } from '../types'

export interface TabMergeResult {
  tabs: Tab[]
  activeId: string | null
}

export function tabsAreClean(current: Tab[], ids: ReadonlySet<string>): boolean {
  return !current.some((tab) => ids.has(tab.id) && tab.dirty)
}

/** Atomically activates an already-open path or appends the new tab once. */
export function activateOrAppendTab(current: Tab[], incoming: Tab): TabMergeResult {
  const existing = incoming.path
    ? current.find((tab) => tab.path === incoming.path)
    : current.find((tab) => tab.id === incoming.id)
  if (existing) return { tabs: current, activeId: existing.id }
  return { tabs: [...current, incoming], activeId: incoming.id }
}

/**
 * Merges asynchronous session reads without duplicating a path already opened
 * by the user while restoration was in flight.
 */
export function mergeRestoredTabs(
  current: Tab[],
  restored: Tab[],
  activePath: string | null,
  currentActiveId: string | null,
): TabMergeResult {
  const seenPaths = new Set(current.flatMap((tab) => (tab.path ? [tab.path] : [])))
  const additions = restored.filter((tab) => {
    if (!tab.path || seenPaths.has(tab.path)) return false
    seenPaths.add(tab.path)
    return true
  })
  const tabs = additions.length > 0 ? [...current, ...additions] : current
  if (currentActiveId && tabs.some((tab) => tab.id === currentActiveId)) {
    return { tabs, activeId: currentActiveId }
  }
  const target =
    (activePath ? tabs.find((tab) => tab.path === activePath) : undefined) ??
    (restored[0]?.path ? tabs.find((tab) => tab.path === restored[0].path) : undefined) ??
    additions[0] ??
    tabs[0]
  return { tabs, activeId: target?.id ?? null }
}
