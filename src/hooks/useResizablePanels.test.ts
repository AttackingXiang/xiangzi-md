import { describe, expect, it } from 'vitest'
import { resizedPanelWidth } from './useResizablePanels'

describe('resizedPanelWidth', () => {
  it('applies direction and clamps every panel to its usable range', () => {
    expect(resizedPanelWidth(256, 100, 140, { min: 160, max: 520, direction: 1 })).toBe(296)
    expect(resizedPanelWidth(240, 100, 140, { min: 160, max: 520, direction: -1 })).toBe(200)
    expect(resizedPanelWidth(200, 100, -500, { min: 160, max: 520, direction: 1 })).toBe(160)
    expect(resizedPanelWidth(500, 100, 500, { min: 160, max: 520, direction: 1 })).toBe(520)
  })
})
