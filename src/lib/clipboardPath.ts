/**
 * Extract one absolute local path from plain-text clipboard content.
 *
 * The clipboard can contain a path copied from a shell, Finder/Explorer, or a
 * file URL. Keep this parser deliberately conservative: a URL or a paragraph
 * of text must never turn into a path-open prompt.
 */
export function clipboardPath(text: string): string | null {
  const lines = text
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length !== 1) return null

  let value = lines[0]
  if (!value) return null

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim()
  }
  if (!value) return null

  if (/^file:/iu.test(value)) return fileUrlPath(value)

  // Accept POSIX, Windows drive, and Windows UNC paths. Relative paths and
  // ordinary schemes (https:, mailto:, etc.) are intentionally excluded.
  if (/^\//u.test(value) || /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value)) {
    return value
  }
  return null
}

function fileUrlPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol.toLowerCase() !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    if (!pathname) return null

    // file://server/share/... is a UNC path. localhost is the local machine.
    if (url.hostname && url.hostname.toLowerCase() !== 'localhost') {
      return `\\\\${url.hostname}${pathname.replace(/\//gu, '\\')}`
    }

    // URL paths for Windows drives are commonly /C:/..., while POSIX paths
    // should remain unchanged.
    if (/^\/[A-Za-z]:[\\/]/u.test(pathname)) return pathname.slice(1)
    return pathname
  } catch {
    return null
  }
}
