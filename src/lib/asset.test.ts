import { describe, expect, it } from 'vitest'
import { imageMimeType, xmdAssetPaths } from './asset'

describe('xmd assets', () => {
  it('decodes the primary and fallback paths in protocol order', () => {
    const source =
      'xmd://localhost/%2Fmissing%2Fimage.png?alts=' +
      encodeURIComponent('/notes/image.png\n/backup/image.png')

    expect(xmdAssetPaths(source)).toEqual([
      '/missing/image.png',
      '/notes/image.png',
      '/backup/image.png',
    ])
  })

  it('rejects non-xmd URLs and identifies common image MIME types', () => {
    expect(xmdAssetPaths('https://example.com/image.png')).toEqual([])
    expect(imageMimeType('/notes/photo.jpg')).toBe('image/jpeg')
    expect(imageMimeType('C:\\notes\\diagram.svg')).toBe('image/svg+xml')
  })
})
