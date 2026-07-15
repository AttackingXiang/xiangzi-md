export interface FloatingPanelPlacement {
  left: number
  top: number
  maxHeight: number
}

interface FloatingPanelGeometry {
  anchorX: number
  anchorY: number
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
  gap?: number
  margin?: number
}

/** Flip a floating panel around its anchor, then constrain it to the viewport. */
export function placeFloatingPanel({
  anchorX,
  anchorY,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  gap = 6,
  margin = 8,
}: FloatingPanelGeometry): FloatingPanelPlacement {
  const availableBelow = Math.max(0, viewportHeight - margin - anchorY - gap)
  const availableAbove = Math.max(0, anchorY - gap - margin)
  const openBelow = panelHeight <= availableBelow || availableBelow >= availableAbove
  const maxHeight = Math.min(panelHeight, openBelow ? availableBelow : availableAbove)
  const top = openBelow ? anchorY + gap : anchorY - gap - maxHeight

  const fitsRight = anchorX + gap + panelWidth <= viewportWidth - margin
  const left = fitsRight
    ? anchorX + gap
    : Math.max(margin, Math.min(anchorX - gap - panelWidth, viewportWidth - margin - panelWidth))

  return {
    left: Math.round(left),
    top: Math.round(Math.max(margin, top)),
    maxHeight: Math.round(maxHeight),
  }
}
