function normalizedDisplayPath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, (slashes, offset) => (offset === 0 && slashes.length >= 2 ? '//' : '/'))
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, '')
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//')
}

/** Stable identity key; Windows drive and UNC paths compare case-insensitively. */
export function documentPathKey(path: string): string {
  const normalized = normalizedDisplayPath(path)
  return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized
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
  if (!isPathAtOrUnder(normalizedPath, normalizedSource)) return path
  if (sameDocumentPath(normalizedPath, normalizedSource)) return targetPath

  const suffix = normalizedPath.slice(normalizedSource.length).replace(/^\/+/, '')
  const separator = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/'
  return `${targetPath.replace(/[\\/]+$/, '')}${separator}${suffix.replace(/\//g, separator)}`
}
