export type ExportImageFormat = 'png' | 'jpeg'

export function exportFileStem(suggestedName: string): string {
  return suggestedName.replace(/\.(?:md|markdown|mdown|mkd|mdx)$/i, '') || 'document'
}

export function imageFormatForPath(path: string): ExportImageFormat {
  return /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'
}
