import { dirName } from './path'
import { isPathAtOrUnder, replacePathPrefix, sameDocumentPath } from './pathIdentity'

export interface TreeDragPayload {
  path: string
  isDir: boolean
}

export function canDropTreeItem(payload: TreeDragPayload, targetDirPath: string): boolean {
  if (!payload.path || !targetDirPath || sameDocumentPath(payload.path, targetDirPath)) return false
  const sourceParent = dirName(payload.path)
  if (sourceParent && sameDocumentPath(sourceParent, targetDirPath)) return false
  return !payload.isDir || !isPathAtOrUnder(targetDirPath, payload.path)
}

export function replaceMovedPath(path: string, sourcePath: string, targetPath: string): string {
  return replacePathPrefix(path, sourcePath, targetPath)
}
