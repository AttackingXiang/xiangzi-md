import { describe, expect, it } from 'vitest'
import { fitImageDimensions, imageDimensionsFromBytes, planExportImageMemory } from './imageBudget'

describe('image memory budgets', () => {
  it('keeps normal images at their original dimensions', () => {
    expect(fitImageDimensions(1920, 1080, 16_000_000)).toEqual({ width: 1920, height: 1080 })
  })

  it('scales unusually large images without changing their aspect ratio materially', () => {
    const fitted = fitImageDimensions(20_000, 10_000, 16_000_000)
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(16_000_000)
    expect(fitted.width / fitted.height).toBeCloseTo(2, 2)
  })

  it('reads PNG dimensions without decoding the image', () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 1600)
    view.setUint32(20, 1066)

    expect(imageDimensionsFromBytes(bytes)).toEqual({ width: 1600, height: 1066 })
  })

  it('reads JPEG dimensions without decoding the image', () => {
    const bytes = new Uint8Array(21)
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x2a, 0x06, 0x40])

    expect(imageDimensionsFromBytes(bytes)).toEqual({ width: 1600, height: 1066 })
  })

  it('keeps two-times-visible quality when the estimated peak fits', () => {
    const plan = planExportImageMemory([{ width: 1600, height: 1066, displayWidth: 800 }], {
      documentHeight: 17_000,
    })

    expect(plan.images[0]).toMatchObject({ width: 1600, height: 1066 })
    expect(plan.autoScaled).toBe(false)
    expect(plan.overBudget).toBe(false)
  })

  it('adapts toward visible resolution from the decoded-pixel estimate', () => {
    const baseBytes = 100 * 100 * 4 + 100 * 100 * 8
    const plan = planExportImageMemory([{ width: 4000, height: 4000, displayWidth: 1000 }], {
      documentHeight: 100,
      exportWidth: 100,
      maxExportHeight: 100,
      renderChunkHeight: 100,
      fixedOverheadBytes: 0,
      memoryBudgetBytes: baseBytes + 9_000_000,
    })

    expect(plan.images[0].width).toBeGreaterThanOrEqual(1000)
    expect(plan.images[0].width).toBeLessThan(2000)
    expect(plan.autoScaled).toBe(true)
    expect(plan.overBudget).toBe(false)
  })

  it('fits pathological images below visible resolution instead of allowing a canvas crash', () => {
    const baseBytes = 100 * 100 * 4 + 100 * 100 * 8
    const plan = planExportImageMemory([{ width: 4000, height: 4000, displayWidth: 1000 }], {
      documentHeight: 100,
      exportWidth: 100,
      maxExportHeight: 100,
      renderChunkHeight: 100,
      fixedOverheadBytes: 0,
      memoryBudgetBytes: baseBytes + 3_000_000,
    })

    expect(plan.images[0].width).toBeLessThan(1000)
    expect(plan.images[0].width).toBeGreaterThan(800)
    expect(plan.images[0].width).toBe(plan.images[0].height)
    expect(plan.autoScaled).toBe(true)
    expect(plan.overBudget).toBe(false)
  })

  it('accounts for the full long-image output instead of silently capping at 20,000px', () => {
    const plan = planExportImageMemory([], {
      documentHeight: 100_000,
      fixedOverheadBytes: 0,
    })

    expect(plan.estimatedPeakBytes).toBeGreaterThan(256 * 1024 * 1024)
    expect(plan.overBudget).toBe(true)
  })
})
