import { describe, expect, it } from 'vitest'
import { guessImageMime } from './backgroundImage'

describe('guessImageMime', () => {
  it('maps common image extensions to their mime type', () => {
    expect(guessImageMime('/Users/x/Pictures/bg.png')).toBe('image/png')
    expect(guessImageMime('/Users/x/Pictures/bg.jpg')).toBe('image/jpeg')
    expect(guessImageMime('/Users/x/Pictures/bg.JPEG')).toBe('image/jpeg')
    expect(guessImageMime('/Users/x/Pictures/bg.webp')).toBe('image/webp')
    expect(guessImageMime('/Users/x/Pictures/bg.gif')).toBe('image/gif')
    expect(guessImageMime('/Users/x/Pictures/bg.bmp')).toBe('image/bmp')
  })

  it('falls back to a generic binary type for unknown extensions', () => {
    expect(guessImageMime('/Users/x/Pictures/bg.tiff')).toBe('application/octet-stream')
    expect(guessImageMime('no-extension')).toBe('application/octet-stream')
  })
})
