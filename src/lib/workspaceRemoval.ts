import type { Tab } from '../types'
import { replaceMovedPath } from './treeDrag'

interface WorkspaceRemovalServices {
  confirmCloseTabs(ids: readonly string[]): Promise<boolean>
  trash(path: string): Promise<unknown>
  closeTabsWithoutPrompt(ids: readonly string[]): void
  refreshTree(): Promise<void>
}

export function affectedTabIds(tabs: readonly Tab[], path: string): string[] {
  const removedPath = `${path}.deleted`
  return tabs
    .filter((tab) => tab.path && replaceMovedPath(tab.path, path, removedPath) !== tab.path)
    .map((tab) => tab.id)
}

export async function removeWorkspacePath(
  path: string,
  tabs: readonly Tab[],
  services: WorkspaceRemovalServices,
): Promise<boolean> {
  const tabIds = affectedTabIds(tabs, path)
  if (!(await services.confirmCloseTabs(tabIds))) return false

  await services.trash(path)
  services.closeTabsWithoutPrompt(tabIds)
  await services.refreshTree()
  return true
}
