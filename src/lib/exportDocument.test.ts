import { describe, expect, it } from 'vitest'
import {
  encodeJpegRgba,
  imageFormatForPath,
  measuredExportHeight,
  plannedExportImageDimensions,
  planPdfLinkAnnotations,
  planPdfPages,
} from './exportDocument'
import { exportFileStem } from './exportFormat'

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

  it('keeps normal long images at full resolution', () => {
    expect(plannedExportImageDimensions(920, 20_000)).toEqual({
      width: 920,
      height: 20_000,
      scale: 1,
    })
  })

  it('bounds pathological long-image memory without cropping document height', () => {
    const dimensions = plannedExportImageDimensions(920, 100_000)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(32_000_000)
    expect(dimensions.width / dimensions.height).toBeCloseTo(920 / 100_000, 4)
    expect(dimensions.height).toBeGreaterThan(0)
    expect(dimensions.scale).toBeLessThan(1)
  })

  it('encodes JPEG in a browser runtime without Node Buffer', async () => {
    const runtime = globalThis as unknown as { Buffer?: unknown }
    const previousBuffer = runtime.Buffer
    delete runtime.Buffer
    try {
      const encoded = await encodeJpegRgba({
        data: new Uint8Array([255, 0, 0, 255]),
        width: 1,
        height: 1,
      })

      expect(Array.from(encoded.slice(0, 2))).toEqual([0xff, 0xd8])
      expect(Array.from(encoded.slice(-2))).toEqual([0xff, 0xd9])
      expect(runtime.Buffer).toBeUndefined()
    } finally {
      if (previousBuffer === undefined) delete runtime.Buffer
      else runtime.Buffer = previousBuffer
    }
  })
})
