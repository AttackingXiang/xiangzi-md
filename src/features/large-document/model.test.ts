import { describe, expect, it } from 'vitest'
import {
  createLargeDocumentSnapshot,
  diffTextOperation,
  findLiteralMatches,
  invertTextOperation,
  applyTextOperation,
  rangeText,
  replaceAllLiterals,
  replaceLiteralAt,
  reorderMarkdownHeadingSections,
} from './model'

describe('large document model', () => {
  it('keeps a lossless chunk snapshot and source offsets', () => {
    const markdown = Array.from(
      { length: 2000 },
      (_, index) => `## H${index}\n\nBody ${index}`,
    ).join('\n\n')
    const snapshot = createLargeDocumentSnapshot(markdown)
    expect(snapshot.ranges.map((range) => rangeText(markdown, range)).join('\n')).toBe(markdown)
    expect(snapshot.sourceOffsets[1]).toBe(snapshot.ranges[0].to + 1)
  })

  it('stores undo history as a reversible source range operation', () => {
    const operation = diffTextOperation('hello world', 'hello brave world')
    expect(operation).toEqual({ from: 6, to: 6, inserted: 'brave ', deleted: '' })
    expect(applyTextOperation('hello world', operation!)).toBe('hello brave world')
    expect(applyTextOperation('hello brave world', invertTextOperation(operation!))).toBe(
      'hello world',
    )
  })

  it('uses ranges to read a chunk without retaining a second full document copy', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.'
    const snapshot = createLargeDocumentSnapshot(markdown)
    expect(snapshot.ranges).toEqual([{ from: 0, to: markdown.length }])
    expect(rangeText(snapshot.markdown, snapshot.ranges[0])).toBe(markdown)
  })

  it('finds and replaces case-insensitive literal matches across the full source', () => {
    const markdown = 'Alpha beta ALPHA'
    expect(findLiteralMatches(markdown, 'alpha')).toEqual([0, 11])
    expect(replaceLiteralAt(markdown, 11, 'alpha', 'x')).toBe('Alpha beta x')
    expect(replaceAllLiterals(markdown, 'alpha', 'x')).toBe('x beta x')
  })

  it('reorders complete heading sections in the full markdown source', () => {
    const markdown = '# A\n\nA body\n\n# B\n\nB body\n'
    expect(reorderMarkdownHeadingSections(markdown, 0, 1)).toBe('# B\n\nB body\n# A\n\nA body\n\n')
  })
})
