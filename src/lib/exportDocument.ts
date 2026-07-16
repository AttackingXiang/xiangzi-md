const EXPORT_DOCUMENT_WIDTH = 920
const PDF_PAGE_WIDTH_PT = 595.28
const PDF_PAGE_HEIGHT_PT = 841.89
const PDF_RENDER_SCALE = 1.5
const EXPORT_IMAGE_LOAD_TIMEOUT_MS = 15_000
const EXPORT_FONT_LOAD_TIMEOUT_MS = 5_000

export interface PdfBlockBoundary {
  top: number
  bottom: number
}

export interface PdfLinkBoundary {
  href: string
  left: number
  top: number
  width: number
  height: number
}

export interface PdfLinkAnnotation extends PdfLinkBoundary {
  pageIndex: number
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

  if (!deferredSource && image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error(`导出图片加载失败（第 ${index + 1} 张）：${image.src}`))
  }

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
    const failed = (): void =>
      finish(new Error(`导出图片加载失败（第 ${index + 1} 张）：${deferredSource ?? image.src}`))
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

export function measuredExportHeight(measured: number): number {
  return Math.max(1, Math.ceil(measured) + 20)
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
  return measuredExportHeight(measured)
}

async function createExportFrame(html: string): Promise<ExportFrame> {
  const frame = document.createElement('iframe')
  frame.title = 'Xiangzi MD export renderer'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${EXPORT_DOCUMENT_WIDTH}px`,
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

    return {
      frame,
      document: doc,
      root,
      width: EXPORT_DOCUMENT_WIDTH,
      height,
      backgroundColor,
    }
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

export function planPdfLinkAnnotations(
  pages: readonly { top: number; height: number }[],
  links: readonly PdfLinkBoundary[],
  scale: number,
): PdfLinkAnnotation[] {
  if (!Number.isFinite(scale) || scale <= 0) return []
  const result: PdfLinkAnnotation[] = []
  pages.forEach((page, pageIndex) => {
    const pageBottom = page.top + page.height
    for (const link of links) {
      const top = Math.max(link.top, page.top)
      const bottom = Math.min(link.top + link.height, pageBottom)
      if (
        !/^https?:|^mailto:/i.test(link.href) ||
        !Number.isFinite(link.left) ||
        !Number.isFinite(link.width) ||
        link.width <= 0 ||
        bottom <= top
      ) {
        continue
      }
      result.push({
        pageIndex,
        href: link.href,
        left: link.left * scale,
        top: (top - page.top) * scale,
        width: link.width * scale,
        height: (bottom - top) * scale,
      })
    }
  })
  return result
}

function collectPdfBlocks(doc: Document): PdfBlockBoundary[] {
  const rootTop = doc.documentElement.getBoundingClientRect().top
  const selector = [
    '.xmd-export-renderer .cm-content > *',
    '.xmd-cm-mermaid-block',
    '.xmd-cm-math-block',
    'table',
    'blockquote',
  ].join(',')

  return Array.from(doc.querySelectorAll<HTMLElement>(selector)).map((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top - rootTop, bottom: rect.bottom - rootTop }
  })
}

function collectPdfLinks(doc: Document): PdfLinkBoundary[] {
  const rootRect = doc.documentElement.getBoundingClientRect()
  return Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('.xmd-export-renderer a[href]'),
  ).flatMap((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    return Array.from(anchor.getClientRects()).map((rect) => ({
      href,
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    }))
  })
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
    const linkAnnotations = planPdfLinkAnnotations(
      pages,
      collectPdfLinks(exportFrame.document),
      PDF_PAGE_WIDTH_PT / exportFrame.width,
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
      for (const link of linkAnnotations.filter((annotation) => annotation.pageIndex === index)) {
        pdf.link(link.left, link.top, link.width, link.height, { url: link.href })
      }
      canvas.width = 1
      canvas.height = 1
      await nextPaint()
    }

    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    exportFrame.frame.remove()
  }
}
