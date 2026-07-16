import { describe, expect, it } from 'vitest'
import { measuredExportHeight, planPdfLinkAnnotations, planPdfPages } from './exportDocument'
import { exportFileStem, imageFormatForPath } from './exportFormat'

describe('exportDocument', () => {
  it('selects JPEG only for JPEG file extensions', () => {
    expect(imageFormatForPath('/tmp/a.JPG')).toBe('jpeg')
    expect(imageFormatForPath('/tmp/a.jpeg')).toBe('jpeg')
    expect(imageFormatForPath('/tmp/a.png')).toBe('png')
    expect(imageFormatForPath('/tmp/a')).toBe('png')
  })

  it('removes every supported Markdown extension from suggested export names', () => {
    expect(exportFileStem('说明.MARKDOWN')).toBe('说明')
    expect(exportFileStem('notes.mdx')).toBe('notes')
    expect(exportFileStem('README')).toBe('README')
    expect(exportFileStem('.md')).toBe('document')
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

  it('keeps external PDF links clickable, including links crossing a page boundary', () => {
    expect(
      planPdfLinkAnnotations(
        [
          { top: 0, height: 100 },
          { top: 100, height: 100 },
        ],
        [
          { href: 'https://example.com', left: 10, top: 90, width: 30, height: 20 },
          { href: 'javascript:alert(1)', left: 0, top: 10, width: 10, height: 10 },
          { href: '#local', left: 0, top: 10, width: 10, height: 10 },
        ],
        2,
      ),
    ).toEqual([
      {
        pageIndex: 0,
        href: 'https://example.com',
        left: 20,
        top: 180,
        width: 60,
        height: 20,
      },
      {
        pageIndex: 1,
        href: 'https://example.com',
        left: 20,
        top: 0,
        width: 60,
        height: 20,
      },
    ])
  })

  it('does not truncate documents taller than the former 20,000px limit', () => {
    expect(measuredExportHeight(42_345.2)).toBe(42_366)
  })
})
