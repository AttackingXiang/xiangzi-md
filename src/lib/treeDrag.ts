import { dirName } from './path'

export const TREE_DRAG_MIME = 'application/x-xiangzi-file-tree'
const TREE_DRAG_TEXT_PREFIX = 'xiangzi-file-tree:'

export interface TreeDragPayload {
  path: string
  isDir: boolean
}

let activePayload: TreeDragPayload | null = null

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLocaleLowerCase() : normalized
}

function parsePayload(value: string): TreeDragPayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<TreeDragPayload>
    return typeof parsed.path === 'string' && typeof parsed.isDir === 'boolean'
      ? { path: parsed.path, isDir: parsed.isDir }
      : null
  } catch {
    return null
  }
}

export function beginTreeDrag(dataTransfer: DataTransfer, payload: TreeDragPayload): void {
  activePayload = payload
  dataTransfer.effectAllowed = 'move'
  const serialized = JSON.stringify(payload)
  try {
    dataTransfer.setData(TREE_DRAG_MIME, serialized)
  } catch {
    /* WebKit may reject custom MIME types; the in-memory payload remains available. */
  }
  try {
    dataTransfer.setData('text/plain', TREE_DRAG_TEXT_PREFIX + serialized)
  } catch {
    /* The in-memory payload is the final fallback for desktop webviews. */
  }
}

export function peekTreeDrag(): TreeDragPayload | null {
  return activePayload
}

export function readTreeDrag(dataTransfer: DataTransfer): TreeDragPayload | null {
  const custom = parsePayload(dataTransfer.getData(TREE_DRAG_MIME))
  if (custom) return custom
  const text = dataTransfer.getData('text/plain')
  if (text.startsWith(TREE_DRAG_TEXT_PREFIX)) {
    const fallback = parsePayload(text.slice(TREE_DRAG_TEXT_PREFIX.length))
    if (fallback) return fallback
  }
  return activePayload
}

export function endTreeDrag(): void {
  activePayload = null
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
