import { describe, expect, it } from 'vitest'
import { clampLightboxScale } from '../lib/lightboxZoom'

describe('clampLightboxScale', () => {
  it('limits interactive zoom to a usable range', () => {
    expect(clampLightboxScale(0.1)).toBe(1)
    expect(clampLightboxScale(2)).toBe(2)
    expect(clampLightboxScale(20)).toBe(6)
  })
})
