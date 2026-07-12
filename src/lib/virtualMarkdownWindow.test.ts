import { describe, expect, it } from 'vitest'
import { chunkIndexAtOffset, virtualMarkdownWindow } from './virtualMarkdownWindow'

const offsets = [0, 10_000, 20_000, 30_000]

describe('virtual markdown window', () => {
  it('maps a scrollbar offset to its fixed chunk', () => {
    expect(chunkIndexAtOffset(offsets, 0)).toBe(0)
    expect(chunkIndexAtOffset(offsets, 15_000)).toBe(1)
    expect(chunkIndexAtOffset(offsets, 30_000)).toBe(2)
  })

  it('keeps only the current chunk in its middle', () => {
    expect(virtualMarkdownWindow(offsets, 14_500, 1_000)).toEqual([1])
  })

  it('preloads only the previous chunk near the top edge', () => {
    expect(virtualMarkdownWindow(offsets, 10_500, 1_000)).toEqual([0, 1])
  })

  it('preloads only the next chunk near the bottom edge', () => {
    expect(virtualMarkdownWindow(offsets, 18_500, 1_000)).toEqual([1, 2])
  })

  it('never returns three chunks when both edge zones overlap', () => {
    const shortOffsets = [0, 1_000, 2_000, 3_000]
    const result = virtualMarkdownWindow(shortOffsets, 1_000, 1_000)
    expect(result).toHaveLength(2)
    expect(result).toEqual([0, 1])
  })
})
