import { blobPartFromBytes } from './asset'

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

export function guessImageMime(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  const extension = match?.[1]?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/** 把读到的图片字节转成可用于 CSS background-image 的 blob: URL。调用方负责在
 * 路径变化或卸载时用 URL.revokeObjectURL 释放，避免累积内存。 */
export function bytesToBlobUrl(bytes: Uint8Array, path: string): string {
  const blob = new Blob([blobPartFromBytes(bytes)], { type: guessImageMime(path) })
  return URL.createObjectURL(blob)
}
