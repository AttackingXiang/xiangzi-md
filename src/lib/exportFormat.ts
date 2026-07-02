export type ExportImageFormat = 'png' | 'jpeg'

export function imageFormatForPath(path: string): ExportImageFormat {
  return /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'
}
