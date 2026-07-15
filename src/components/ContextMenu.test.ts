import { describe, expect, it } from 'vitest'
import { placeFloatingPanel } from './floatingPanelPosition'

describe('context menu placement', () => {
  it('opens below and beside the pointer when there is enough room', () => {
    expect(
      placeFloatingPanel({
        anchorX: 100,
        anchorY: 100,
        panelWidth: 216,
        panelHeight: 300,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 106, top: 106, maxHeight: 300 })
  })

  it('flips above the pointer instead of shifting underneath it', () => {
    expect(
      placeFloatingPanel({
        anchorX: 400,
        anchorY: 700,
        panelWidth: 216,
        panelHeight: 500,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 406, top: 194, maxHeight: 500 })
  })

  it('uses the larger side and clips tall menus without covering the pointer', () => {
    expect(
      placeFloatingPanel({
        anchorX: 900,
        anchorY: 500,
        panelWidth: 216,
        panelHeight: 700,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 678, top: 8, maxHeight: 486 })
  })
})
