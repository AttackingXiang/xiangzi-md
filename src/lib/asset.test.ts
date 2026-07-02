import { describe, expect, it } from 'vitest'
import {
  BLOCKED_REMOTE_IMAGE,
  blobPartFromBytes,
  imageMimeType,
  resolveAssetURL,
  xmdAssetPaths,
} from './asset'

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

  it('reuses complete ArrayBuffers and trims sliced byte views', () => {
    const full = new Uint8Array([1, 2, 3, 4])
    expect(blobPartFromBytes(full)).toBe(full.buffer)
    expect(new Uint8Array(blobPartFromBytes(full.subarray(1, 3)))).toEqual(new Uint8Array([2, 3]))
  })

  it('blocks remote images by default and only permits them after opt-in', () => {
    const remote = 'https://images.example/private.png'
    expect(resolveAssetURL('/notes', remote)).toBe(BLOCKED_REMOTE_IMAGE)
    expect(resolveAssetURL('/notes', remote, null, [], true)).toBe(remote)
  })
})
