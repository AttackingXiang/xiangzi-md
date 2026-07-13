import { describe, expect, it } from 'vitest'
import { splitMarkdownIntoChunks } from './markdownChunker'

function assertRoundTrip(md: string, target: number) {
  const chunks = splitMarkdownIntoChunks(md, target)
  expect(chunks.join('\n')).toBe(md)
}

/** 统计一段文本中 ``` 围栏行的数量（用来判断某个 chunk 内围栏是否配平）。 */
function countFenceLines(text: string): number {
  return text.split('\n').filter((line) => /^\s*`{3,}/.test(line)).length
}

describe('splitMarkdownIntoChunks', () => {
  it('round-trips an empty string', () => {
    assertRoundTrip('', 50)
    expect(splitMarkdownIntoChunks('', 50)).toEqual([''])
  })

  it('round-trips a small single-paragraph doc', () => {
    assertRoundTrip('Hello world, this is a short paragraph.', 50)
  })

  it('round-trips a multi-block doc', () => {
    const md = [
      '# Title',
      '',
      'Paragraph one.',
      '',
      '- item 1',
      '- item 2',
      '',
      '## Subtitle',
      '',
      'Paragraph two with more text to pad it out a little bit.',
    ].join('\n')
    assertRoundTrip(md, 30)
  })

  it('round-trips a doc with a large fenced code block', () => {
    const md = [
      'Intro paragraph.',
      '',
      '```js',
      'function foo() {',
      '',
      '  return 42;',
      '',
      '}',
      '```',
      '',
      'Outro paragraph.',
    ].join('\n')
    assertRoundTrip(md, 20)
  })

  it('round-trips a doc with a table', () => {
    const md = [
      'Before table.',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '| 3 | 4 |',
      '',
      'After table.',
    ].join('\n')
    assertRoundTrip(md, 25)
  })

  it('returns a single chunk when the doc is smaller than the target', () => {
    const md = 'short doc'
    const chunks = splitMarkdownIntoChunks(md, 1000)
    expect(chunks).toEqual([md])
  })

  it('does not split inside a fenced code block that contains blank lines and exceeds target', () => {
    const md = [
      'Intro.',
      '',
      '```js',
      'line one',
      '',
      'line two',
      '',
      'line three',
      '```',
      '',
      'Outro.',
    ].join('\n')
    const chunks = splitMarkdownIntoChunks(md, 15)
    assertRoundTrip(md, 15)
    // Every chunk must have an even number of ``` fence lines (no unterminated fence).
    for (const chunk of chunks) {
      expect(countFenceLines(chunk) % 2).toBe(0)
    }
  })

  it('handles both ``` and ~~~ fences', () => {
    const md = [
      'Intro.',
      '',
      '~~~python',
      'def foo():',
      '',
      '    return 1',
      '~~~',
      '',
      'Outro.',
    ].join('\n')
    const chunks = splitMarkdownIntoChunks(md, 15)
    assertRoundTrip(md, 15)
    for (const chunk of chunks) {
      const fenceLines = chunk.split('\n').filter((line) => /^\s*~{3,}/.test(line)).length
      expect(fenceLines % 2).toBe(0)
    }
  })

  it('splits a large multi-paragraph doc into multiple chunks bounded by target + one block', () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Paragraph number ${i} with some padding text.`,
    )
    const md = paragraphs.join('\n\n')
    const target = 40
    const chunks = splitMarkdownIntoChunks(md, target)
    assertRoundTrip(md, target)
    expect(chunks.length).toBeGreaterThan(1)
    const maxParagraphLength = Math.max(...paragraphs.map((p) => p.length))
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(target + maxParagraphLength + 2)
    }
  })

  it('keeps a table with no internal blank lines in one chunk even if it exceeds target', () => {
    const rows = Array.from({ length: 8 }, (_, i) => `| row${i} | value${i} | more${i} |`)
    const md = ['Before.', '', '| a | b | c |', '| - | - | - |', ...rows, '', 'After.'].join('\n')
    const target = 10
    const chunks = splitMarkdownIntoChunks(md, target)
    assertRoundTrip(md, target)

    const tableBlock = ['| a | b | c |', '| - | - | - |', ...rows].join('\n')
    const containingChunk = chunks.find((c) => c.includes(tableBlock))
    expect(containingChunk).toBeDefined()
  })
})
