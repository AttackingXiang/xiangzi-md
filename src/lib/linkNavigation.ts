import { sourceHeadings } from '../features/cm6-editor/outline'
import { dirName } from './path'

export type RelativeLinkTarget =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'markdown'; path: string; anchor?: string }

/** GitHub/CM live-preview compatible heading slug, including duplicate suffixes. */
export function markdownHeadingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
export function headingOffsetForAnchor(markdown: string, rawAnchor: string): number | null {
  let anchor: string
  try {
    anchor = decodeURIComponent(rawAnchor.replace(/^#/, ''))
  } catch {
    return null
  }
  const wanted = anchor.toLowerCase()
  const occurrences = new Map<string, number>()
  for (const heading of sourceHeadings(markdown)) {
    const base = markdownHeadingSlug(heading.text)
    const seen = occurrences.get(base) ?? 0
    occurrences.set(base, seen + 1)
    const slug = seen === 0 ? base : `${base}-${seen}`
    if (slug === wanted) return heading.offset
  }
  return null
}

/** Resolve only anchors and Markdown files confined to the active file's directory. */
export function resolveRelativeMarkdownLink(
  href: string,
  activeFilePath: string | null,
): RelativeLinkTarget | null {
  const trimmed = href.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (trimmed.startsWith('#')) return { kind: 'anchor', anchor: trimmed.slice(1) }
  if (!activeFilePath || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null

  const hash = trimmed.indexOf('#')
  const encodedPath = hash >= 0 ? trimmed.slice(0, hash) : trimmed
  const encodedAnchor = hash >= 0 ? trimmed.slice(hash + 1) : undefined
  if (!encodedPath || encodedPath.startsWith('/') || encodedPath.startsWith('\\')) return null

  let relativePath: string
  let anchor: string | undefined
  try {
    relativePath = decodeURIComponent(encodedPath).replace(/\\/g, '/')
    anchor = encodedAnchor === undefined ? undefined : decodeURIComponent(encodedAnchor)
  } catch {
    return null
  }
  if (relativePath.startsWith('/') || relativePath.startsWith('//')) return null
  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.')
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null
  const fileName = segments.at(-1) ?? ''
  if (!/\.md(?:own)?$/i.test(fileName)) return null

  const directory = dirName(activeFilePath)
  if (!directory) return null
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return {
    kind: 'markdown',
    path: `${directory}${directory.endsWith(separator) ? '' : separator}${segments.join(separator)}`,
    ...(anchor ? { anchor } : {}),
  }
}
