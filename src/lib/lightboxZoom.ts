const MIN_SCALE = 1
const MAX_SCALE = 6

export function clampLightboxScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}
