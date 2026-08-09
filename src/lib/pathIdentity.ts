import { currentDesktopPlatform, type DesktopPlatform } from './platform'

function normalizedDisplayPath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, (slashes, offset) => (offset === 0 && slashes.length >= 2 ? '//' : '/'))
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, '')
}

function isWindowsPath(path: string, platform: DesktopPlatform): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith('\\\\') ||
    (platform === 'windows' && path.startsWith('//'))
  )
}

/** Stable identity key; Windows drive and UNC paths compare case-insensitively. */
export function documentPathKeyForPlatform(path: string, platform: DesktopPlatform): string {
  const windowsPath = isWindowsPath(path, platform)
  const normalized = normalizedDisplayPath(path)
  return windowsPath ? normalized.toLowerCase() : normalized
}

export function documentPathKey(path: string): string {
  return documentPathKeyForPlatform(path, currentDesktopPlatform())
}

export function sameDocumentPath(left: string, right: string): boolean {
  return documentPathKey(left) === documentPathKey(right)
}

export function isPathAtOrUnder(candidate: string, base: string): boolean {
  const candidateKey = documentPathKey(candidate)
  const baseKey = documentPathKey(base)
  const descendantPrefix = baseKey.endsWith('/') ? baseKey : `${baseKey}/`
  return candidateKey === baseKey || candidateKey.startsWith(descendantPrefix)
}

/** Replace one path prefix while preserving every descendant segment's original casing. */
export function replacePathPrefix(path: string, sourcePath: string, targetPath: string): string {
  const normalizedPath = normalizedDisplayPath(path)
  const normalizedSource = normalizedDisplayPath(sourcePath)
  if (!isPathAtOrUnder(path, sourcePath)) return path
  if (sameDocumentPath(path, sourcePath)) return targetPath

  const suffix = normalizedPath.slice(normalizedSource.length).replace(/^\/+/, '')
  const separator = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/'
  return `${targetPath.replace(/[\\/]+$/, '')}${separator}${suffix.replace(/\//g, separator)}`
}
