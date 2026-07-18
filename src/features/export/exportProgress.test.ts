import { describe, expect, it } from 'vitest'
import { estimateRemainingSeconds } from './exportProgress'

describe('long-image export progress', () => {
  it('estimates remaining time from elapsed rendering progress', () => {
    expect(estimateRemainingSeconds(10_000, 25)).toBe(30)
    expect(estimateRemainingSeconds(90_000, 75)).toBe(30)
  })

  it('waits for a useful sample and hides the estimate at completion', () => {
    expect(estimateRemainingSeconds(500, 25)).toBeUndefined()
    expect(estimateRemainingSeconds(10_000, 0)).toBeUndefined()
    expect(estimateRemainingSeconds(10_000, 100)).toBeUndefined()
  })
})
