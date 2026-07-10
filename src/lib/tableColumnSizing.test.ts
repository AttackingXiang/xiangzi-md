import { describe, expect, it } from 'vitest'
import { fitColumnsToContainer, fitColumnsToContents } from './tableColumnSizing'

describe('fitColumnsToContainer', () => {
  it('fills the container exactly while favoring content-heavy columns', () => {
    const widths = fitColumnsToContainer(
      [
        { min: 50, preferred: 100 },
        { min: 70, preferred: 300 },
        { min: 50, preferred: 100 },
      ],
      600,
    )
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(600)
    expect(widths[1]).toBeGreaterThan(widths[0])
    expect(Math.abs(widths[0] - widths[2])).toBeLessThanOrEqual(1)
  })

  it('degrades below min-content without overflowing', () => {
    const widths = fitColumnsToContainer(
      Array.from({ length: 5 }, () => ({ min: 120, preferred: 240 })),
      300,
    )
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(300)
    expect(widths.every((width) => width === 60)).toBe(true)
  })

  it('distributes rounding error across tracks', () => {
    expect(
      fitColumnsToContainer(
        Array.from({ length: 3 }, () => ({ min: 1, preferred: 1 })),
        100,
      ),
    ).toEqual([34, 33, 33])
  })
})

describe('fitColumnsToContents', () => {
  it('uses intrinsic preferred widths with minimum and maximum caps', () => {
    expect(
      fitColumnsToContents([
        { min: 20, preferred: 30 },
        { min: 90, preferred: 80 },
        { min: 100, preferred: 900 },
      ]),
    ).toEqual([64, 90, 640])
  })
})
