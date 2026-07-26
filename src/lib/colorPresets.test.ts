import { describe, expect, it } from 'vitest'
import { normalizeHexColor } from './colorPresets'

describe('normalizeHexColor', () => {
  it('normalizes safe six-digit colors and rejects other CSS values', () => {
    expect(normalizeHexColor(' #12ABcd ')).toBe('#12abcd')
    expect(normalizeHexColor('#fff')).toBeNull()
    expect(normalizeHexColor('red')).toBeNull()
    expect(normalizeHexColor('#123456;display:none')).toBeNull()
  })
})
