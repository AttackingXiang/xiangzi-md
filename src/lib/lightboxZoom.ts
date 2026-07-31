export const GRAPHIC_MIN_SCALE = 0.05
export const GRAPHIC_MAX_SCALE = 6
export const TABLE_MIN_SCALE = 0.5
export const TABLE_MAX_SCALE = 3

const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6]

export function clampPreviewScale(scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, scale))
}

export function clampLightboxScale(scale: number): number {
  return clampPreviewScale(scale, GRAPHIC_MIN_SCALE, GRAPHIC_MAX_SCALE)
}

export function fitPreviewScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  min: number,
  max: number,
): number {
  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return clampPreviewScale(1, min, max)
  }
  return clampPreviewScale(
    Math.min(1, viewportWidth / contentWidth, viewportHeight / contentHeight),
    min,
    max,
  )
}

export function nextPreviewScale(
  scale: number,
  direction: 'in' | 'out',
  min: number,
  max: number,
): number {
  const candidates = Array.from(new Set([min, ...ZOOM_STEPS, max]))
    .filter((value) => value >= min && value <= max)
    .sort((a, b) => a - b)
  const epsilon = 0.001
  if (direction === 'in') {
    return candidates.find((value) => value > scale + epsilon) ?? max
  }
  return candidates.reverse().find((value) => value < scale - epsilon) ?? min
}
