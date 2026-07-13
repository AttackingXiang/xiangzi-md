import type { ImageDimensions } from './imageBudget'

const IMAGE_DECODE_TIMEOUT_MS = 15_000
const OWNED_OBJECT_URL_ATTRIBUTE = 'data-xmd-export-owned-url'

export function exportOwnedObjectUrlAttribute(): string {
  return OWNED_OBJECT_URL_ATTRIBUTE
}

export function ownedExportObjectUrls(html: string): string[] {
  const pattern = new RegExp(`${OWNED_OBJECT_URL_ATTRIBUTE}="([^"]+)"`, 'g')
  return [...html.matchAll(pattern)].map((match) => match[1])
}

export function releaseExportObjectUrls(html: string): void {
  for (const url of new Set(ownedExportObjectUrls(html))) URL.revokeObjectURL(url)
}

/**
 * Own object URLs while an export document is being assembled. Successful
 * exports transfer ownership to the serialized HTML (and are released by the
 * desktop adapter); failed assembly must release them here because no HTML is
 * returned to the adapter.
 */
export async function withOwnedExportObjectUrls<T>(
  operation: (create: (blob: Blob) => string) => Promise<T>,
): Promise<T> {
  const owned = new Set<string>()
  try {
    const result = await operation((blob) => {
      const url = URL.createObjectURL(blob)
      owned.add(url)
      return url
    })
    if (result === null || result === undefined) {
      for (const url of owned) URL.revokeObjectURL(url)
    }
    return result
  } catch (error) {
    for (const url of owned) URL.revokeObjectURL(url)
    throw error
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('图片转换结果无效'))
      },
      { once: true },
    )
    reader.addEventListener('error', () => reject(reader.error ?? new Error('图片转换失败')), {
      once: true,
    })
    reader.readAsDataURL(blob)
  })
}

function resizedMimeType(sourceType: string): string {
  if (sourceType === 'image/jpeg' || sourceType === 'image/webp') return sourceType
  return 'image/png'
}

/** Downscales only the temporary export copy; the source file remains untouched. */
export async function resizeImageBlob(
  blob: Blob,
  source: ImageDimensions,
  target: ImageDimensions,
): Promise<Blob> {
  if (target.width >= source.width && target.height >= source.height) return blob

  const objectUrl = URL.createObjectURL(blob)
  const image = new Image()
  image.loading = 'eager'
  image.decoding = 'async'
  let canvas: HTMLCanvasElement | null = null

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('导出图片解码超时')),
        IMAGE_DECODE_TIMEOUT_MS,
      )
      image.addEventListener(
        'load',
        () => {
          window.clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      image.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout)
          reject(new Error('导出图片解码失败'))
        },
        { once: true },
      )
      image.src = objectUrl
    })

    canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建导出图片画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, target.width, target.height)
    const mimeType = resizedMimeType(blob.type)
    return await new Promise<Blob>((resolve, reject) => {
      canvas?.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('导出图片缩放失败'))),
        mimeType,
        mimeType === 'image/png' ? undefined : 0.92,
      )
    })
  } finally {
    image.removeAttribute('src')
    URL.revokeObjectURL(objectUrl)
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}
