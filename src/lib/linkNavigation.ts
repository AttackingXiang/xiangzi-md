import { GFM, parser as markdownParser } from '@lezer/markdown'
import { dirName } from './path'

export type RelativeLinkTarget =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'markdown'; path: string; anchor?: string }

export interface MarkdownHeading {
  level: number
  text: string
  offset: number
}

/** A source-backed heading record shared by outline and anchor navigation.
 *
 * This deliberately comes from the complete Markdown source rather than live-preview
 * DOM.  Consequently it remains available while a virtualized heading is unmounted.
 */
export interface MarkdownHeadingIndexEntry extends MarkdownHeading {
  slug: string
}

export interface MarkdownHeadingOptions {
  /** Exclude headings nested inside quotes and list items. */
  topLevelOnly?: boolean
}

const headingInlineParser = markdownParser.configure([GFM])
type HeadingSyntaxNode = ReturnType<typeof headingInlineParser.parse>['topNode']
const HIDDEN_INLINE_MARKS = new Set([
  'CodeMark',
  'EmphasisMark',
  'HeaderMark',
  'LinkMark',
  'StrikethroughMark',
])

function decodeHeadingEntity(source: string): string {
  const numeric = /^&#(x[\da-f]+|\d+);$/i.exec(source)?.[1]
  if (numeric) {
    const value = Number.parseInt(numeric.replace(/^x/i, ''), /^x/i.test(numeric) ? 16 : 10)
    if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) {
      try {
        return String.fromCodePoint(value)
      } catch {
        return ''
      }
    }
  }
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return named[source.slice(1, -1).toLowerCase()] ?? source
}

function directHeadingChildren(node: HeadingSyntaxNode, name: string): HeadingSyntaxNode[] {
  const children: HeadingSyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) children.push(child)
  }
  return children
}

function headingTextInRange(
  node: HeadingSyntaxNode,
  source: string,
  from: number,
  to: number,
): string {
  let result = ''
  let cursor = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) continue
    if (child.from >= to) break
    if (child.from > cursor) result += source.slice(cursor, Math.min(child.from, to))
    if (child.from >= from && child.to <= to) result += headingTextForNode(child, source)
    cursor = Math.max(cursor, Math.min(child.to, to))
  }
  if (cursor < to) result += source.slice(cursor, to)
  return result
}

function headingTextForNode(node: HeadingSyntaxNode, source: string): string {
  if (HIDDEN_INLINE_MARKS.has(node.name) || node.name === 'HTMLTag') return ''
  if (node.name === 'Escape') return source.slice(node.from + 1, node.to)
  if (node.name === 'Entity') return decodeHeadingEntity(source.slice(node.from, node.to))
  if (node.name === 'Link' || node.name === 'Image' || node.name === 'Autolink') {
    const marks = directHeadingChildren(node, 'LinkMark')
    if (marks.length >= 2) {
      return headingTextInRange(node, source, marks[0].to, marks[1].from)
    }
  }
  if (!node.firstChild) return source.slice(node.from, node.to)
  return headingTextInRange(node, source, node.from, node.to)
}

function firstNonWhitespace(source: string, from: number, to: number): number | null {
  for (let position = from; position < to; ) {
    const point = source.codePointAt(position)
    if (point === undefined) return null
    const character = String.fromCodePoint(point)
    if (!/\s/u.test(character)) return position
    position += character.length
  }
  return null
}

function firstVisibleOffsetInRange(
  node: HeadingSyntaxNode,
  source: string,
  from: number,
  to: number,
): number | null {
  let cursor = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) continue
    if (child.from >= to) break
    if (child.from > cursor) {
      const gap = firstNonWhitespace(source, cursor, Math.min(child.from, to))
      if (gap !== null) return gap
    }
    if (child.from >= from && child.to <= to) {
      const visible = firstVisibleOffsetForNode(child, source)
      if (visible !== null) return visible
    }
    cursor = Math.max(cursor, Math.min(child.to, to))
  }
  return cursor < to ? firstNonWhitespace(source, cursor, to) : null
}

function firstVisibleOffsetForNode(node: HeadingSyntaxNode, source: string): number | null {
  if (HIDDEN_INLINE_MARKS.has(node.name) || node.name === 'HTMLTag') return null
  if (node.name === 'Escape') return node.from + 1 < node.to ? node.from + 1 : null
  if (node.name === 'Link' || node.name === 'Image' || node.name === 'Autolink') {
    const marks = directHeadingChildren(node, 'LinkMark')
    if (marks.length >= 2) {
      return firstVisibleOffsetInRange(node, source, marks[0].to, marks[1].from)
    }
  }
  if (!node.firstChild) return node.from < node.to ? node.from : null
  return firstVisibleOffsetInRange(node, source, node.from, node.to)
}

/** Visible heading text, excluding Markdown markers, link targets, and inline HTML tags. */
export function markdownHeadingText(source: string): string {
  const tree = headingInlineParser.parse(source)
  return headingTextInRange(tree.topNode, source, 0, source.length)
}

/** First source position that contributes visible heading text. */
export function markdownHeadingContentOffset(source: string): number | null {
  const tree = headingInlineParser.parse(source)
  return firstVisibleOffsetInRange(tree.topNode, source, 0, source.length)
}

/** Parse CommonMark/GFM ATX and Setext headings with source offsets. */
export function markdownHeadings(
  markdown: string,
  options: MarkdownHeadingOptions = {},
): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  headingInlineParser.parse(markdown).iterate({
    enter(node) {
      const match = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/.exec(node.name)
      if (!match) return
      if (options.topLevelOnly && node.node.parent?.name !== 'Document') return false
      headings.push({
        level: Number(match[1] ?? match[2]),
        text: headingTextForNode(node.node, markdown).trim(),
        offset: markdown.lastIndexOf('\n', Math.max(0, node.from - 1)) + 1,
      })
      return false
    },
  })
  return headings
}

/**
 * Build the stable, source-backed heading index used by both the outline and `#anchor`
 * navigation. Duplicate slugs follow GitHub/CommonMark live-preview suffix semantics.
 */
export function markdownHeadingIndex(
  markdown: string,
  options: MarkdownHeadingOptions = {},
): MarkdownHeadingIndexEntry[] {
  const usedSlugs = new Set<string>()
  return markdownHeadings(markdown, options).map((heading) => {
    const base = markdownHeadingSlug(heading.text)
    let slug = base
    let suffix = 0
    while (usedSlugs.has(slug)) {
      suffix += 1
      slug = `${base}-${suffix}`
    }
    usedSlugs.add(slug)
    return { ...heading, slug }
  })
}

/** GitHub/CM live-preview compatible heading slug, including duplicate suffixes. */
export function markdownHeadingSlug(text: string): string {
  return markdownHeadingText(text)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

interface SourceAnchorIndex {
  definitions: Array<{ label: string; offset: number }>
  references: Array<{ label: string; offset: number }>
  blocks: Map<string, number>
}

function normalizeFootnoteLabel(label: string): string {
  return label.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function sourceAnchorIndex(markdown: string): SourceAnchorIndex {
  const definitions: SourceAnchorIndex['definitions'] = []
  const references: SourceAnchorIndex['references'] = []
  const blocks = new Map<string, number>()
  const linePattern = /.*(?:\n|$)/g
  let fence: { marker: '`' | '~'; length: number } | null = null
  for (const lineMatch of markdown.matchAll(linePattern)) {
    if (!lineMatch[0]) continue
    const offset = lineMatch.index
    const withoutNewline = lineMatch[0].endsWith('\n') ? lineMatch[0].slice(0, -1) : lineMatch[0]
    const line = withoutNewline.endsWith('\r') ? withoutNewline.slice(0, -1) : withoutNewline
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (
        marker === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ''
      )
        fence = null
      continue
    }
    if (fence) continue

    const definition = /^ {0,3}\[\^([^\]\r\n]+)\]:/.exec(line)
    if (definition) {
      definitions.push({ label: normalizeFootnoteLabel(definition[1]), offset })
    }
    for (const reference of line.matchAll(/\[\^([^\]\r\n]+)\]/g)) {
      if (definition && reference.index === line.indexOf('[^')) continue
      references.push({
        label: normalizeFootnoteLabel(reference[1]),
        offset: offset + reference.index,
      })
    }
    const block = /(?:^|[ \t])\^([\p{Letter}\p{Number}_-]+)[ \t]*$/u.exec(line)
    if (block && !blocks.has(block[1])) blocks.set(block[1], offset)
  }
  return { definitions, references, blocks }
}

function matchingFootnote(
  entries: SourceAnchorIndex['definitions'],
  requested: string,
): { label: string; offset: number } | null {
  if (/^\d+$/.test(requested)) return entries[Number(requested) - 1] ?? null
  const normalized = normalizeFootnoteLabel(requested)
  const slug = markdownHeadingSlug(normalized)
  return (
    entries.find(
      (entry) => entry.label === normalized || markdownHeadingSlug(entry.label) === slug,
    ) ?? null
  )
}

function sourceOffsetForAnchor(markdown: string, decodedAnchor: string): number | null {
  if (decodedAnchor.startsWith('^')) {
    return sourceAnchorIndex(markdown).blocks.get(decodedAnchor.slice(1)) ?? null
  }

  const anchor = decodedAnchor.replace(/^user-content-/i, '')
  const footnote = /^(fnref|fn)(?:-|:)(.+)$/i.exec(anchor) ?? /^(fnref|fn)(\d+)$/i.exec(anchor)
  if (!footnote) return null
  const index = sourceAnchorIndex(markdown)
  let definition = matchingFootnote(index.definitions, footnote[2])
  if (!definition && footnote[1].toLowerCase() === 'fnref') {
    definition = matchingFootnote(index.definitions, footnote[2].replace(/-\d+$/, ''))
  }
  if (!definition) return null
  if (footnote[1].toLowerCase() === 'fnref') {
    return (
      index.references.find((reference) => reference.label === definition.label)?.offset ?? null
    )
  }
  return definition.offset
}

export function headingOffsetForAnchor(markdown: string, rawAnchor: string): number | null {
  let anchor: string
  try {
    anchor = decodeURIComponent(rawAnchor.replace(/^#/, ''))
  } catch {
    return null
  }
  if (!anchor || /[\u0000-\u001f\u007f]/.test(anchor)) return null
  const wanted = markdownHeadingSlug(anchor)
  if (!wanted) return null
  for (const heading of markdownHeadingIndex(markdown)) {
    const { slug } = heading
    if (slug === wanted) return heading.offset
  }
  return sourceOffsetForAnchor(markdown, anchor)
}

/** Resolve only anchors and Markdown files confined to the active file's directory. */
export function resolveRelativeMarkdownLink(
  href: string,
  activeFilePath: string | null,
): RelativeLinkTarget | null {
  const trimmed = href.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (trimmed.startsWith('#')) {
    const encodedAnchor = trimmed.slice(1)
    try {
      const decodedAnchor = decodeURIComponent(encodedAnchor)
      if (!decodedAnchor || /[\u0000-\u001f\u007f]/.test(decodedAnchor)) return null
    } catch {
      return null
    }
    return { kind: 'anchor', anchor: encodedAnchor }
  }
  if (!activeFilePath || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null

  const hash = trimmed.indexOf('#')
  const encodedPath = hash >= 0 ? trimmed.slice(0, hash) : trimmed
  const encodedAnchor = hash >= 0 ? trimmed.slice(hash + 1) : undefined
  if (!encodedPath || encodedPath.startsWith('/') || encodedPath.startsWith('\\')) return null

  let relativePath: string
  let decodedAnchor: string | undefined
  try {
    relativePath = decodeURIComponent(encodedPath).replace(/\\/g, '/')
    decodedAnchor = encodedAnchor === undefined ? undefined : decodeURIComponent(encodedAnchor)
  } catch {
    return null
  }
  if (
    /[\u0000-\u001f\u007f]/.test(relativePath) ||
    (decodedAnchor !== undefined && /[\u0000-\u001f\u007f]/.test(decodedAnchor)) ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('//')
  )
    return null
  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || /^\.\.[. ]+$/u.test(segment))
  )
    return null
  const fileName = segments.at(-1) ?? ''
  if (!/\.md(?:own)?$/i.test(fileName)) return null

  const directory = dirName(activeFilePath)
  if (!directory) return null
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return {
    kind: 'markdown',
    path: `${directory}${directory.endsWith(separator) ? '' : separator}${segments.join(separator)}`,
    ...(encodedAnchor ? { anchor: encodedAnchor } : {}),
  }
}
