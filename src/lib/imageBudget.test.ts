import { describe, expect, it } from 'vitest'
import { fitImageDimensions } from './imageBudget'

describe('image memory budgets', () => {
  it('keeps normal images at their original dimensions', () => {
    expect(fitImageDimensions(1920, 1080, 16_000_000)).toEqual({ width: 1920, height: 1080 })
  })

  it('scales unusually large images without changing their aspect ratio materially', () => {
    const fitted = fitImageDimensions(20_000, 10_000, 16_000_000)
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(16_000_000)
    expect(fitted.width / fitted.height).toBeCloseTo(2, 2)
  })
})
