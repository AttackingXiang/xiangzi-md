const EXPORT_WIDTH = 920
const MAX_EXPORT_HEIGHT = 20_000
const RENDER_CHUNK_HEIGHT = 4_000
const PDF_PAGE_WIDTH_PT = 595.28
const PDF_PAGE_HEIGHT_PT = 841.89
const PDF_RENDER_SCALE = 1.5
const EXPORT_IMAGE_LOAD_TIMEOUT_MS = 15_000
const EXPORT_FONT_LOAD_TIMEOUT_MS = 5_000

export type { ExportImageFormat } from './exportFormat'

export interface PdfBlockBoundary {
  top: number
  bottom: number
}

interface ExportFrame {
  frame: HTMLIFrameElement
  document: Document
  root: HTMLElement
  width: number
  height: number
  backgroundColor: string
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function waitForFrameLoad(frame: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('导出文档加载超时')), 15_000)
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
    frame.srcdoc = html
  })
}

function waitForImage(image: HTMLImageElement, index: number): Promise<void> {
  const deferredSource = image.getAttribute('data-xmd-export-src')
  image.loading = 'eager'

  if (!deferredSource && image.complete) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      image.removeEventListener('load', loaded)
      image.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const loaded = (): void => finish()
    const failed = (): void => finish()
    const timeout = window.setTimeout(
      () => finish(new Error(`导出图片加载超时（第 ${index + 1} 张）`)),
      EXPORT_IMAGE_LOAD_TIMEOUT_MS,
    )

    // Register handlers before restoring the source: data URLs can complete in
    // the same event-loop turn, especially in WebKit.
    image.addEventListener('load', loaded, { once: true })
    image.addEventListener('error', failed, { once: true })
    if (deferredSource) {
      image.setAttribute('src', deferredSource)
      image.removeAttribute('data-xmd-export-src')
    }
    if (image.complete && image.naturalWidth > 0) queueMicrotask(loaded)
  })
}

async function waitForFonts(doc: Document): Promise<void> {
  if (!doc.fonts) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, EXPORT_FONT_LOAD_TIMEOUT_MS)
    void doc.fonts.ready.then(finish, finish)
  })
}

async function waitForAssets(doc: Document): Promise<void> {
  await waitForFonts(doc)
  for (const [index, image] of Array.from(doc.images).entries()) {
    await waitForImage(image, index)
  }
}

function documentHeight(doc: Document): number {
  const body = doc.body
  const root = doc.documentElement
  const measured = Math.max(
    body.scrollHeight,
    body.offsetHeight,
    root.scrollHeight,
    root.offsetHeight,
  )
  return Math.max(1, Math.min(MAX_EXPORT_HEIGHT, Math.ceil(measured) + 20))
}

async function createExportFrame(html: string): Promise<ExportFrame> {
  const frame = document.createElement('iframe')
  frame.title = 'Xiangzi MD export renderer'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${EXPORT_WIDTH}px`,
    'height:800px',
    'border:0',
    'pointer-events:none',
  ].join(';')
  document.body.appendChild(frame)

  try {
    await waitForFrameLoad(frame, html)
    const doc = frame.contentDocument
    if (!doc) throw new Error('无法创建导出文档')

    await waitForAssets(doc)
    const height = documentHeight(doc)
    frame.style.height = `${height}px`
    await nextPaint()

    const root = doc.documentElement
    const backgroundColor =
      getComputedStyle(doc.body).backgroundColor ||
      getComputedStyle(root).backgroundColor ||
      '#ffffff'

    return { frame, document: doc, root, width: EXPORT_WIDTH, height, backgroundColor }
  } catch (error) {
    frame.remove()
    throw error
  }
}

async function renderSection(
  exportFrame: ExportFrame,
  y: number,
  height: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro')
  return html2canvas(exportFrame.root, {
    allowTaint: false,
    backgroundColor: exportFrame.backgroundColor,
    height,
    imageSmoothing: true,
    imageSmoothingQuality: 'high',
    logging: false,
    removeContainer: true,
    scale,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width: exportFrame.width,
    windowHeight: exportFrame.height,
    windowWidth: exportFrame.width,
    x: 0,
    y,
  })
}

async function renderRgba(exportFrame: ExportFrame): Promise<Uint8Array> {
  const pixels = new Uint8Array(exportFrame.width * exportFrame.height * 4)

  for (let y = 0; y < exportFrame.height; y += RENDER_CHUNK_HEIGHT) {
    const height = Math.min(RENDER_CHUNK_HEIGHT, exportFrame.height - y)
    const canvas = await renderSection(exportFrame, y, height, 1)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取导出图片')
    const imageData = context.getImageData(0, 0, exportFrame.width, height)
    pixels.set(imageData.data, y * exportFrame.width * 4)
    canvas.width = 1
    canvas.height = 1
    await nextPaint()
  }

  return pixels
}

export { imageFormatForPath } from './exportFormat'

export function planPdfPages(
  documentHeight: number,
  pageHeight: number,
  blockBoundaries: PdfBlockBoundary[],
): Array<{ top: number; height: number }> {
  if (documentHeight <= 0 || pageHeight <= 0) return []

  const blocks = blockBoundaries
    .filter(({ top, bottom }) => Number.isFinite(top) && Number.isFinite(bottom) && bottom > top)
    .sort((left, right) => left.top - right.top)
  const pages: Array<{ top: number; height: number }> = []
  let top = 0

  while (top < documentHeight) {
    const hardBottom = Math.min(documentHeight, top + pageHeight)
    let bottom = hardBottom

    if (hardBottom < documentHeight) {
      const crossing = blocks.find(
        (block) =>
          block.top > top + pageHeight * 0.2 && block.top < hardBottom && block.bottom > hardBottom,
      )
      if (crossing) bottom = crossing.top
    }

    if (bottom <= top + 1) bottom = hardBottom
    pages.push({ top, height: bottom - top })
    top = bottom
  }

  return pages
}

function collectPdfBlocks(doc: Document): PdfBlockBoundary[] {
  const rootTop = doc.documentElement.getBoundingClientRect().top
  const selector = [
    '.export-content > *',
    '.mermaid-export',
    '.milkdown-code-block',
    'pre',
    'table',
    'blockquote',
  ].join(',')

  return Array.from(doc.querySelectorAll<HTMLElement>(selector)).map((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top - rootTop, bottom: rect.bottom - rootTop }
  })
}

export async function renderDocumentImage(
  html: string,
  format: ExportImageFormat,
): Promise<Uint8Array> {
  const exportFrame = await createExportFrame(html)
  try {
    const data = await renderRgba(exportFrame)
    if (format === 'jpeg') {
      const [{ Buffer }, jpeg] = await Promise.all([import('buffer'), import('jpeg-js')])
      if (!globalThis.Buffer) globalThis.Buffer = Buffer
      return new Uint8Array(
        jpeg.encode({ data, width: exportFrame.width, height: exportFrame.height }, 92).data,
      )
    }

    const { encode } = await import('fast-png')
    return encode({
      width: exportFrame.width,
      height: exportFrame.height,
      data,
      depth: 8,
      channels: 4,
    })
  } finally {
    exportFrame.frame.remove()
  }
}

export async function renderDocumentPdf(html: string): Promise<Uint8Array> {
  const exportFrame = await createExportFrame(html)
  try {
    const [{ jsPDF }] = await Promise.all([import('jspdf')])
    const cssPageHeight = (exportFrame.width * PDF_PAGE_HEIGHT_PT) / PDF_PAGE_WIDTH_PT
    const pages = planPdfPages(
      exportFrame.height,
      cssPageHeight,
      collectPdfBlocks(exportFrame.document),
    )
    const pdf = new jsPDF({
      compress: true,
      format: 'a4',
      orientation: 'portrait',
      unit: 'pt',
    })

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]
      if (index > 0) pdf.addPage('a4', 'portrait')
      const canvas = await renderSection(exportFrame, page.top, page.height, PDF_RENDER_SCALE)
      const renderedHeight = (page.height / exportFrame.width) * PDF_PAGE_WIDTH_PT
      pdf.addImage(canvas, 'JPEG', 0, 0, PDF_PAGE_WIDTH_PT, renderedHeight, undefined, 'FAST')
      canvas.width = 1
      canvas.height = 1
      await nextPaint()
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    exportFrame.frame.remove()
  }
}
import type { ExportImageFormat } from './exportFormat'
