export interface ImageDimensions {
  width: number
  height: number
}

export interface ExportImageBudgetInput extends ImageDimensions {
  displayWidth: number
}

export interface ExportImageBudgetItem extends ImageDimensions {
  sourceWidth: number
  sourceHeight: number
  displayWidth: number
}

export interface ExportImageBudgetPlan {
  images: ExportImageBudgetItem[]
  estimatedPeakBytes: number
  memoryBudgetBytes: number
  autoScaled: boolean
  overBudget: boolean
}

export interface ExportImageBudgetOptions {
  documentHeight: number
  exportWidth?: number
  maxExportHeight?: number
  renderChunkHeight?: number
  memoryBudgetBytes?: number
  fixedOverheadBytes?: number
  preferredPixelRatio?: number
}

const MEBIBYTE = 1024 * 1024
const DEFAULT_EXPORT_WIDTH = 920
const DEFAULT_MAX_EXPORT_HEIGHT = 20_000
const DEFAULT_RENDER_CHUNK_HEIGHT = 4_000
const DEFAULT_MEMORY_BUDGET_BYTES = 256 * MEBIBYTE
const DEFAULT_FIXED_OVERHEAD_BYTES = 24 * MEBIBYTE

export function fitImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
): ImageDimensions {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width)) : 1
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.max(1, Math.floor(height)) : 1
  const pixels = safeWidth * safeHeight
  if (pixels <= Math.max(1, maxPixels)) {
    return { width: safeWidth, height: safeHeight }
  }
  const scale = Math.sqrt(Math.max(1, maxPixels) / pixels)
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
  }
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width: Math.floor(width), height: Math.floor(height) }
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return validDimensions(view.getUint32(16), view.getUint32(20))
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null
  const signature = String.fromCharCode(...bytes.subarray(0, 6))
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return validDimensions(view.getUint16(6, true), view.getUint16(8, true))
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0x01) continue
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return null
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (startOfFrame.has(marker) && length >= 7) {
      return validDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3))
    }
    offset += length
  }
  return null
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null
  const tag = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WEBP') return null
  const kind = tag(12, 4)
  if (kind === 'VP8X') {
    return validDimensions(uint24LittleEndian(bytes, 24) + 1, uint24LittleEndian(bytes, 27) + 1)
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0
    return validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return validDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  }
  return null
}

/** Reads common raster dimensions without decoding the full image into memory. */
export function imageDimensionsFromBytes(bytes: Uint8Array): ImageDimensions | null {
  return (
    pngDimensions(bytes) ?? jpegDimensions(bytes) ?? gifDimensions(bytes) ?? webpDimensions(bytes)
  )
}

function targetDimensions(
  input: ExportImageBudgetInput,
  pixelRatio: number,
): ExportImageBudgetItem {
  const source = validDimensions(input.width, input.height) ?? { width: 1, height: 1 }
  const displayWidth = Math.min(
    source.width,
    Math.max(1, Math.ceil(Number.isFinite(input.displayWidth) ? input.displayWidth : source.width)),
  )
  const width = Math.min(source.width, Math.max(1, Math.ceil(displayWidth * pixelRatio)))
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    displayWidth,
    width,
    height: Math.max(1, Math.round((source.height * width) / source.width)),
  }
}

function imagePixels(images: readonly ExportImageBudgetItem[]): number {
  return images.reduce((total, image) => total + image.width * image.height, 0)
}

/**
 * Plans export image dimensions from decoded pixels and the expected render peak.
 * It first targets 2x visible width, then moves toward 1x visible width when needed.
 */
export function planExportImageMemory(
  inputs: readonly ExportImageBudgetInput[],
  options: ExportImageBudgetOptions,
): ExportImageBudgetPlan {
  const exportWidth = Math.max(1, Math.floor(options.exportWidth ?? DEFAULT_EXPORT_WIDTH))
  const maxExportHeight = Math.max(
    1,
    Math.floor(options.maxExportHeight ?? DEFAULT_MAX_EXPORT_HEIGHT),
  )
  const documentHeight = Math.max(1, Math.min(maxExportHeight, Math.ceil(options.documentHeight)))
  const chunkHeight = Math.max(
    1,
    Math.min(documentHeight, Math.floor(options.renderChunkHeight ?? DEFAULT_RENDER_CHUNK_HEIGHT)),
  )
  const memoryBudgetBytes = Math.max(
    1,
    Math.floor(options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES),
  )
  const fixedOverheadBytes = Math.max(
    0,
    Math.floor(options.fixedOverheadBytes ?? DEFAULT_FIXED_OVERHEAD_BYTES),
  )
  const preferredPixelRatio = Math.max(1, options.preferredPixelRatio ?? 2)
  const renderBytes = exportWidth * documentHeight * 4 + exportWidth * chunkHeight * 8
  const baseBytes = fixedOverheadBytes + renderBytes
  const preferred = inputs.map((input) => targetDimensions(input, preferredPixelRatio))
  const minimum = inputs.map((input) => targetDimensions(input, 1))
  const availablePixels = Math.max(0, Math.floor((memoryBudgetBytes - baseBytes) / 4))
  let images = preferred

  if (imagePixels(preferred) > availablePixels && imagePixels(minimum) <= availablePixels) {
    let low = 0
    let high = 1
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const factor = (low + high) / 2
      const candidate = preferred.map((image, index) => {
        const floor = minimum[index]
        const width = Math.max(
          floor.width,
          Math.floor(floor.width + (image.width - floor.width) * factor),
        )
        return {
          ...image,
          width,
          height: Math.max(1, Math.round((image.sourceHeight * width) / image.sourceWidth)),
        }
      })
      if (imagePixels(candidate) <= availablePixels) low = factor
      else high = factor
    }
    images = preferred.map((image, index) => {
      const floor = minimum[index]
      const width = Math.max(
        floor.width,
        Math.floor(floor.width + (image.width - floor.width) * low),
      )
      return {
        ...image,
        width,
        height: Math.max(1, Math.round((image.sourceHeight * width) / image.sourceWidth)),
      }
    })
  } else if (imagePixels(minimum) > availablePixels) {
    // Never scale below the actual export display width. This preserves visible
    // quality; callers can warn before continuing if the estimate stays high.
    images = minimum
  }

  const estimatedPeakBytes = baseBytes + imagePixels(images) * 4
  return {
    images,
    estimatedPeakBytes,
    memoryBudgetBytes,
    autoScaled: images.some((image, index) => image.width < preferred[index].width),
    overBudget: estimatedPeakBytes > memoryBudgetBytes,
  }
}
