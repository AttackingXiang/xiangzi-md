import { describe, expect, it } from 'vitest'
import { summarizeContentDiff } from './contentDiff'

describe('summarizeContentDiff', () => {
  it('reports added and removed lines around unchanged content', () => {
    const result = summarizeContentDiff('one\ntwo\nthree', 'one\nTWO\nthree\nfour')
    expect(result.added).toBe(2)
    expect(result.removed).toBe(1)
    expect(result.preview.map((line) => `${line.type}:${line.text}`)).toEqual([
      'removed:two',
      'added:TWO',
      'added:four',
    ])
  })

  it('treats a new document as added content', () => {
    const result = summarizeContentDiff('', '# Draft\ncontent')
    expect(result.added).toBe(2)
    expect(result.removed).toBe(0)
  })

  it('limits the preview without losing totals', () => {
    const result = summarizeContentDiff(
      '',
      Array.from({ length: 20 }, (_, i) => `${i}`).join('\n'),
      3,
    )
    expect(result.added).toBe(20)
    expect(result.preview).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('ignores the serializer terminal newline', () => {
    const result = summarizeContentDiff('', 'draft\n')
    expect(result.added).toBe(1)
    expect(result.preview[0]?.text).toBe('draft')
  })

  it('keeps the preview bounded for a very large unsaved document', () => {
    const result = summarizeContentDiff('', 'line\n'.repeat(200_000), 5)
    expect(result.added).toBe(200_000)
    expect(result.preview).toHaveLength(5)
    expect(result.truncated).toBe(true)
  })
})
