export interface ImageDimensions {
  width: number
  height: number
}

export function fitImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
): ImageDimensions {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width)) : 1
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.max(1, Math.floor(height)) : 1
  const pixels = safeWidth * safeHeight
  if (pixels <= Math.max(1, maxPixels)) return { width: safeWidth, height: safeHeight }
  const scale = Math.sqrt(Math.max(1, maxPixels) / pixels)
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
  }
}
