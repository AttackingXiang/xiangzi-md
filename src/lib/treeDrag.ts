import { dirName } from './path'

export interface TreeDragPayload {
  path: string
  isDir: boolean
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLocaleLowerCase() : normalized
}

export function canDropTreeItem(payload: TreeDragPayload, targetDirPath: string): boolean {
  const source = normalizePath(payload.path)
  const target = normalizePath(targetDirPath)
  if (!source || !target || source === target) return false
  if (normalizePath(dirName(payload.path) ?? '') === target) return false
  return !payload.isDir || !target.startsWith(source + '/')
}

export function replaceMovedPath(path: string, sourcePath: string, targetPath: string): string {
  const pathKey = normalizePath(path)
  const sourceKey = normalizePath(sourcePath)
  if (pathKey === sourceKey) return targetPath
  if (!pathKey.startsWith(sourceKey + '/')) return path

  const suffix = pathKey.slice(sourceKey.length)
  const separator = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/'
  return targetPath + suffix.replace(/\//g, separator)
}
