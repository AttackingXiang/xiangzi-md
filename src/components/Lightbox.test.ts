import { describe, expect, it } from 'vitest'
import { clampLightboxScale, fitPreviewScale, nextPreviewScale } from '../lib/lightboxZoom'

describe('clampLightboxScale', () => {
  it('allows fit-to-window zoom below actual size while keeping hard bounds', () => {
    expect(clampLightboxScale(0.01)).toBe(0.05)
    expect(clampLightboxScale(0.1)).toBe(0.1)
    expect(clampLightboxScale(2)).toBe(2)
    expect(clampLightboxScale(20)).toBe(6)
  })

  it('fits large content inside the available viewport without enlarging small content', () => {
    expect(fitPreviewScale(2000, 1000, 1000, 800, 0.05, 6)).toBe(0.5)
    expect(fitPreviewScale(400, 300, 1000, 800, 0.05, 6)).toBe(1)
  })

  it('moves toolbar zoom through readable fixed percentage steps', () => {
    expect(nextPreviewScale(1, 'in', 0.05, 6)).toBe(1.25)
    expect(nextPreviewScale(1, 'out', 0.05, 6)).toBe(0.75)
    expect(nextPreviewScale(0.5, 'out', 0.5, 3)).toBe(0.5)
    expect(nextPreviewScale(3, 'in', 0.5, 3)).toBe(3)
  })
})
