import { renderMermaidForExport } from './mermaidPreview'
import { svgMarkupToPng } from './richClipboard'

type MermaidImageRenderer = (source: string) => Promise<string>

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Mermaid 图片转换结果无效')),
      { once: true },
    )
    reader.addEventListener(
      'error',
      () => reject(reader.error ?? new Error('Mermaid 图片转换失败')),
      { once: true },
    )
    reader.readAsDataURL(blob)
  })
}

async function renderMermaidDataUrl(source: string): Promise<string> {
  const svg = await renderMermaidForExport(source)
  const backgroundColor =
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff'
  const png = await svgMarkupToPng(svg, backgroundColor)
  if (!png) throw new Error('Mermaid 图表栅格化失败')
  return blobToDataUrl(png)
}

interface FenceOpening {
  marker: '`' | '~'
  length: number
}

function mermaidFenceOpening(line: string): FenceOpening | null {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line)
  if (!match || match[2].trim().split(/\s+/, 1)[0]?.toLowerCase() !== 'mermaid') return null
  return { marker: match[1][0] as '`' | '~', length: match[1].length }
}

function closesFence(line: string, opening: FenceOpening): boolean {
  const trimmed = line.replace(/^ {0,3}/, '').trimEnd()
  if (trimmed.length < opening.length) return false
  return Array.from(trimmed).every((character) => character === opening.marker)
}

/** Render Mermaid fences to embedded PNG data URIs before handing Markdown to Pandoc. */
export async function prepareMarkdownForDocx(
  markdown: string,
  renderImage: MermaidImageRenderer = renderMermaidDataUrl,
): Promise<string> {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? []
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.replace(/\r?\n$/, '')
    const opening = mermaidFenceOpening(line)
    if (!opening) {
      output.push(rawLine)
      continue
    }

    let closingIndex = index + 1
    while (closingIndex < lines.length) {
      const candidate = lines[closingIndex].replace(/\r?\n$/, '')
      if (closesFence(candidate, opening)) break
      closingIndex += 1
    }
    if (closingIndex >= lines.length) {
      output.push(rawLine)
      continue
    }

    const source = lines
      .slice(index + 1, closingIndex)
      .join('')
      .replace(/\r?\n$/, '')
    const dataUrl = await renderImage(source)
    const newline = rawLine.endsWith('\r\n') ? '\r\n' : '\n'
    output.push(`![Mermaid diagram](${dataUrl})${newline}`)
    index = closingIndex
  }

  return output.join('')
}
