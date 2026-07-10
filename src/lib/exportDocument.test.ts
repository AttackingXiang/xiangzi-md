import { describe, expect, it } from 'vitest'
import { imageFormatForPath, measuredExportHeight, planPdfPages } from './exportDocument'

describe('exportDocument', () => {
  it('selects JPEG only for JPEG file extensions', () => {
    expect(imageFormatForPath('/tmp/a.JPG')).toBe('jpeg')
    expect(imageFormatForPath('/tmp/a.jpeg')).toBe('jpeg')
    expect(imageFormatForPath('/tmp/a.png')).toBe('png')
    expect(imageFormatForPath('/tmp/a')).toBe('png')
  })

  it('moves a crossing block to the next PDF page when there is enough room', () => {
    expect(planPdfPages(2_000, 1_000, [{ top: 800, bottom: 1_200 }])).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 1_000 },
      { top: 1_800, height: 200 },
    ])
  })

  it('hard-splits oversized blocks without producing an empty page', () => {
    expect(planPdfPages(2_100, 1_000, [{ top: 10, bottom: 2_000 }])).toEqual([
      { top: 0, height: 1_000 },
      { top: 1_000, height: 1_000 },
      { top: 2_000, height: 100 },
    ])
  })

  it('does not truncate documents taller than the former 20,000px limit', () => {
    expect(measuredExportHeight(42_345.2)).toBe(42_366)
  })
})
