import { splitMarkdownIntoChunks } from '../../lib/markdownChunker'
import { VIRTUAL_MARKDOWN_CHUNK_CHARS } from '../../lib/virtualMarkdownWindow'
import { parseOutline } from '../../lib/outline'

export interface LargeDocumentSnapshot {
  markdown: string
  ranges: LargeDocumentRange[]
  sourceOffsets: number[]
}

export interface LargeDocumentRange {
  from: number
  to: number
}

export interface TextOperation {
  from: number
  to: number
  inserted: string
  deleted: string
}

export function createLargeDocumentSnapshot(markdown: string): LargeDocumentSnapshot {
  const chunks = splitMarkdownIntoChunks(markdown, VIRTUAL_MARKDOWN_CHUNK_CHARS)
  const ranges: LargeDocumentRange[] = []
  const sourceOffsets = new Array<number>(chunks.length + 1)
  let from = 0
  for (let i = 0; i < chunks.length; i += 1) {
    const to = from + chunks[i].length
    ranges.push({ from, to })
    sourceOffsets[i] = from
    from = to + 1
  }
  sourceOffsets[chunks.length] = markdown.length
  return { markdown, ranges, sourceOffsets }
}

export function rangeText(markdown: string, range: LargeDocumentRange | undefined): string {
  return range ? markdown.slice(range.from, range.to) : ''
}

export function applyTextOperation(markdown: string, operation: TextOperation): string {
  return markdown.slice(0, operation.from) + operation.inserted + markdown.slice(operation.to)
}

export function invertTextOperation(operation: TextOperation): TextOperation {
  return {
    from: operation.from,
    to: operation.from + operation.inserted.length,
    inserted: operation.deleted,
    deleted: operation.inserted,
  }
}

/** Build the smallest single range replacement that transforms `before` into `after`. */
export function diffTextOperation(before: string, after: string): TextOperation | null {
  if (before === after) return null
  let from = 0
  const common = Math.min(before.length, after.length)
  while (from < common && before[from] === after[from]) from += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > from && afterEnd > from && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return {
    from,
    to: beforeEnd,
    inserted: after.slice(from, afterEnd),
    deleted: before.slice(from, beforeEnd),
  }
}

export function findLiteralMatches(markdown: string, query: string): number[] {
  if (!query) return []
  const haystack = markdown.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const matches: number[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, from)
    if (found < 0) break
    matches.push(found)
    from = found + Math.max(1, needle.length)
  }
  return matches
}

export function replaceLiteralAt(
  markdown: string,
  offset: number,
  query: string,
  replacement: string,
): string {
  if (
    !query ||
    markdown.slice(offset, offset + query.length).toLocaleLowerCase() !== query.toLocaleLowerCase()
  ) {
    return markdown
  }
  return markdown.slice(0, offset) + replacement + markdown.slice(offset + query.length)
}

export function replaceAllLiterals(markdown: string, query: string, replacement: string): string {
  const matches = findLiteralMatches(markdown, query)
  if (!matches.length) return markdown
  let result = ''
  let cursor = 0
  for (const offset of matches) {
    result += markdown.slice(cursor, offset) + replacement
    cursor = offset + query.length
  }
  return result + markdown.slice(cursor)
}

export function reorderMarkdownHeadingSections(
  markdown: string,
  fromIndex: number,
  toIndex: number,
): string {
  if (fromIndex === toIndex) return markdown
  const headings = parseOutline(markdown)
  const source = headings[fromIndex]
  const target = headings[toIndex]
  if (!source || !target) return markdown
  const sectionEnd = (index: number): number => {
    const heading = headings[index]
    for (let i = index + 1; i < headings.length; i += 1) {
      if (headings[i].level <= heading.level) return headings[i].offset
    }
    return markdown.length
  }
  const sourceEnd = sectionEnd(fromIndex)
  const sourceText = markdown.slice(source.offset, sourceEnd)
  const withoutSource = markdown.slice(0, source.offset) + markdown.slice(sourceEnd)
  if (fromIndex < toIndex) {
    const targetEnd = sectionEnd(toIndex) - sourceText.length
    return withoutSource.slice(0, targetEnd) + sourceText + withoutSource.slice(targetEnd)
  }
  return withoutSource.slice(0, target.offset) + sourceText + withoutSource.slice(target.offset)
}
