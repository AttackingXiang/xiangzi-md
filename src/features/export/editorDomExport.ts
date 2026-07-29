import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createCm6Editor } from '../cm6-editor/controller'
import { cm6ExportMode } from '../cm6-editor/core/exportMode'
import { markdownEditorExportBridge } from '../cm6-editor/exportBridge'
import { mermaidSourceForBlock } from '../cm6-editor/mermaidPreview'
import type { RasterImageSource } from '../../platform/contracts'
import type { ExportImageFormat } from '../../lib/exportFormat'
import { renderMermaidForExport } from '../../lib/mermaidPreview'

const CAPTURE_VIEWPORT_HEIGHT = 2_048
const ASSET_SETTLE_TIMEOUT_MS = 15_000
const FONT_SETTLE_TIMEOUT_MS = 5_000
const WARM_PASSES = 5
const CAPTURE_OVERLAP = 128
const UNSPLITTABLE_BLOCK_SELECTOR = [
  '.xmd-cm-mermaid-block',
  '.xmd-cm-math-block',
  '.xmd-cm-table-preview',
  '.xmd-cm-image-preview.is-block',
].join(',')

export function exportRasterViewportHeight(webViewHeight: number): number {
  if (!Number.isFinite(webViewHeight)) return 1
  return Math.max(1, Math.min(CAPTURE_VIEWPORT_HEIGHT, Math.floor(webViewHeight)))
}

interface EditorDomExportSession {
  root: HTMLElement
  view: EditorView
  requiresFullRasterDom: boolean
  destroy(): void
}

interface EditorDomExportSessionOptions {
  signal?: AbortSignal
}

interface RasterBlockBounds {
  top: number
  bottom: number
}

interface RasterBlockSnapshot {
  canvas: HTMLCanvasElement
  left: number
  top: number
}

interface PrintableEditorView extends EditorView {
  viewState: { printing: boolean }
  measure(): void
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('导出已取消', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

function nextPaint(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (signal?.aborted) {
          reject(abortError(signal))
          return
        }
        resolve()
      }),
    ),
  )
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = (): void => {
      window.clearTimeout(timeout)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function waitForFonts(signal?: AbortSignal): Promise<void> {
  if (!document.fonts) return
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    delay(FONT_SETTLE_TIMEOUT_MS, signal),
  ])
  throwIfAborted(signal)
}

function viewportSignature(session: EditorDomExportSession): string {
  const { root, view } = session
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
  const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 0).length
  const loadingMermaid = root.querySelectorAll('.xmd-cm-mermaid-preview.is-loading').length
  return [
    Math.ceil(view.contentHeight),
    root.querySelectorAll('*').length,
    images.length,
    loadedImages,
    loadingMermaid,
  ].join(':')
}

async function settleViewport(
  session: EditorDomExportSession,
  timeoutMs = ASSET_SETTLE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  let previous = ''
  let stableFrames = 0

  while (performance.now() < deadline) {
    throwIfAborted(signal)
    session.view.requestMeasure()
    await nextPaint(signal)
    const signature = viewportSignature(session)
    const pendingImage = Array.from(session.root.querySelectorAll<HTMLImageElement>('img')).some(
      (image) => !image.complete,
    )
    const pendingMermaid = Boolean(session.root.querySelector('.xmd-cm-mermaid-preview.is-loading'))
    if (
      visibleUnsplittableBlocks(session).some(
        ({ top, bottom }) => bottom - top > session.root.clientHeight,
      )
    ) {
      session.requiresFullRasterDom = true
    }
    stableFrames = signature === previous ? stableFrames + 1 : 0
    previous = signature
    if (stableFrames >= 2 && !pendingImage && !pendingMermaid) return
    await delay(32, signal)
  }
  // Missing images deliberately fall back to source/placeholder UI. Export
  // what the editor settled on instead of making one unavailable asset block
  // the entire document forever.
}

function documentHeight(view: EditorView): number {
  return Math.max(1, Math.ceil(view.contentHeight))
}

function rasterDocumentHeight(view: EditorView): number {
  // `contentHeight` is fractional, while scrollTop and canvas rows are integer
  // pixels. Using ceil(contentHeight) can make the final crop one pixel taller
  // than the last viewport. The scroller's integer scrollHeight is the exact
  // raster coordinate space we stitch below.
  return Math.max(1, view.scrollDOM.scrollHeight)
}

function documentBoundsForRects(
  session: EditorDomExportSession,
  rects: readonly DOMRect[],
): RasterBlockBounds | null {
  if (rects.length === 0) return null
  const scrollerTop = session.view.scrollDOM.getBoundingClientRect().top
  const scrollTop = session.view.scrollDOM.scrollTop
  const top = Math.min(...rects.map((rect) => rect.top)) - scrollerTop + scrollTop
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) - scrollerTop + scrollTop
  return bottom > top ? { top, bottom } : null
}

function visibleUnsplittableBlocks(session: EditorDomExportSession): RasterBlockBounds[] {
  const bounds = Array.from(session.root.querySelectorAll<HTMLElement>(UNSPLITTABLE_BLOCK_SELECTOR))
    .map((element) => documentBoundsForRects(session, [element.getBoundingClientRect()]))
    .filter((value): value is RasterBlockBounds => value !== null)

  for (const first of session.root.querySelectorAll<HTMLElement>(
    '.cm-line.xmd-cm-code-line-first',
  )) {
    const lines = [first]
    let current = first.nextElementSibling
    while (current instanceof HTMLElement && current.classList.contains('xmd-cm-code-line')) {
      lines.push(current)
      if (current.classList.contains('xmd-cm-code-line-last')) break
      current = current.nextElementSibling
    }
    const block = documentBoundsForRects(
      session,
      lines.map((line) => line.getBoundingClientRect()),
    )
    if (block) bounds.push(block)
  }

  return bounds.sort((left, right) => left.top - right.top)
}

export function rowsBeforeUnsplittableBlock(
  outputTop: number,
  maxRows: number,
  viewportHeight: number,
  blocks: readonly RasterBlockBounds[],
): number {
  const proposedBottom = outputTop + maxRows
  for (const block of blocks) {
    const top = Math.floor(block.top)
    const bottom = Math.ceil(block.bottom)
    if (bottom - top > viewportHeight) continue
    if (top <= outputTop || top >= proposedBottom || bottom <= proposedBottom) continue
    const rows = top - outputTop
    if (rows > 0) return rows
  }
  return maxRows
}

async function scrollTo(
  session: EditorDomExportSession,
  top: number,
  signal?: AbortSignal,
): Promise<number> {
  session.view.scrollDOM.scrollTop = Math.max(0, Math.floor(top))
  session.view.requestMeasure()
  await settleViewport(session, ASSET_SETTLE_TIMEOUT_MS, signal)
  return Math.max(0, Math.floor(session.view.scrollDOM.scrollTop))
}

async function positionOutputViewport(
  session: EditorDomExportSession,
  outputTop: number,
  viewportHeight: number,
  signal?: AbortSignal,
  preferExactTop = false,
): Promise<number> {
  let desiredTop = Math.min(
    Math.max(0, preferExactTop ? outputTop : outputTop - CAPTURE_OVERLAP),
    Math.max(0, session.view.scrollDOM.scrollHeight - viewportHeight),
  )
  let actualTop = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    actualTop = await scrollTo(session, desiredTop, signal)
    if (actualTop <= outputTop && outputTop - actualTop < viewportHeight) return actualTop
    desiredTop = Math.max(0, desiredTop - Math.ceil(viewportHeight / 2))
  }
  return actualTop
}

async function stabilizeRasterDocument(
  session: EditorDomExportSession,
  viewportHeight: number,
  signal?: AbortSignal,
): Promise<number> {
  await waitForFonts(signal)
  let previousHeight = -1
  let stablePasses = 0

  for (let pass = 0; pass < WARM_PASSES; pass += 1) {
    let outputTop = 0
    let height = rasterDocumentHeight(session.view)
    while (outputTop < height) {
      throwIfAborted(signal)
      const actualTop = await positionOutputViewport(session, outputTop, viewportHeight, signal)
      const availableRows = viewportHeight - Math.max(0, outputTop - actualTop)
      if (actualTop > outputTop || availableRows <= 0) break
      outputTop += Math.min(height - outputTop, availableRows)
      height = rasterDocumentHeight(session.view)
    }

    const nextHeight = rasterDocumentHeight(session.view)
    stablePasses = nextHeight === previousHeight ? stablePasses + 1 : 0
    if (stablePasses >= 1) {
      await scrollTo(session, 0, signal)
      return nextHeight
    }
    previousHeight = nextHeight
  }

  await scrollTo(session, 0, signal)
  return rasterDocumentHeight(session.view)
}

async function materializeFullRasterDocument(
  session: EditorDomExportSession,
  signal?: AbortSignal,
): Promise<number> {
  const printable = session.view as unknown as PrintableEditorView
  printable.viewState.printing = true
  let height = documentHeight(session.view)
  let previousHeight = -1

  for (let attempt = 0; attempt < WARM_PASSES; attempt += 1) {
    throwIfAborted(signal)
    session.root.style.height = `${height}px`
    session.view.scrollDOM.scrollTop = 0
    printable.measure()
    await settleViewport(session, ASSET_SETTLE_TIMEOUT_MS, signal)
    const measured = documentHeight(session.view)
    if (measured === previousHeight) {
      height = measured
      break
    }
    previousHeight = height = measured
  }

  session.root.style.height = `${height}px`
  session.view.scrollDOM.scrollTop = 0
  printable.measure()
  await settleViewport(session, ASSET_SETTLE_TIMEOUT_MS, signal)
  return documentHeight(session.view)
}

async function createEditorDomExportSession(
  options: EditorDomExportSessionOptions = {},
): Promise<EditorDomExportSession> {
  const snapshot = markdownEditorExportBridge.snapshot()
  if (!snapshot) throw new Error('当前没有可导出的 Markdown 编辑器')
  // Mermaid measures labels while producing its SVG viewBox. Rendering before
  // the active fonts settle can permanently cache bounds computed with a
  // fallback font and clip labels at the SVG edge on another WebView engine.
  await waitForFonts(options.signal)

  const root = document.createElement('div')
  // CM6 only materializes the part of a scroll container that intersects the
  // actual WebView viewport (plus a render margin). A taller hidden root would
  // leave a real `.cm-gap` at the bottom of every raster tile, which
  // html2canvas faithfully turns into a large white band.
  const viewportHeight = exportRasterViewportHeight(window.innerHeight)
  root.className = snapshot.className
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${snapshot.width}px`,
    `height:${viewportHeight}px`,
    'pointer-events:none',
    'z-index:-2147483647',
  ].join(';')
  const mount = document.createElement('div')
  mount.className = 'xmd-cm-mount'
  root.append(mount)
  document.body.append(root)

  try {
    const controller = createCm6Editor({
      parent: mount,
      value: snapshot.value,
      readOnly: true,
      extensions: [
        snapshot.extensions,
        cm6ExportMode.of(true),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
      ariaLabel: 'Markdown export renderer',
    })
    await nextPaint()
    return {
      root,
      view: controller.view,
      requiresFullRasterDom: false,
      destroy: () => {
        controller.destroy()
        root.remove()
      },
    }
  } catch (error) {
    root.remove()
    throw error
  }
}

function exportBackgroundColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  return value || '#ffffff'
}

async function captureViewport(
  session: EditorDomExportSession,
  backgroundColor: string,
  top = 0,
  height = session.root.clientHeight,
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro')
  return html2canvas(session.root, {
    allowTaint: false,
    backgroundColor,
    height,
    imageSmoothing: true,
    imageSmoothingQuality: 'high',
    logging: false,
    removeContainer: true,
    scale: 1,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width: session.root.clientWidth,
    windowHeight: Math.max(window.innerHeight, height),
    windowWidth: session.root.clientWidth,
    y: top,
    onclone: (clonedDocument) => {
      const clonedScroller = clonedDocument.querySelector<HTMLElement>(
        '.xmd-export-renderer .cm-scroller',
      )
      if (clonedScroller) clonedScroller.scrollTop = session.view.scrollDOM.scrollTop
    },
  })
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

async function captureMermaidBlock(
  element: HTMLElement,
  source: string,
): Promise<HTMLCanvasElement | null> {
  // html2canvas serializes an inline SVG as one replaced image. When that SVG
  // starts in an earlier tile, WebView engines may omit or clip it entirely.
  // Rasterize a foreignObject-free Mermaid SVG once, then composite slices of
  // this stable bitmap into every document tile below.
  const displayedSvg = element.querySelector<SVGSVGElement>('.xmd-cm-mermaid-content > svg')
  const preview = element.querySelector<HTMLElement>('.xmd-cm-mermaid-preview')
  if (!displayedSvg || !preview) return null

  const template = document.createElement('template')
  template.innerHTML = await renderMermaidForExport(source)
  const svg = template.content.querySelector('svg')
  if (!svg) return null

  const rect = element.getBoundingClientRect()
  const previewRect = preview.getBoundingClientRect()
  const svgRect = displayedSvg.getBoundingClientRect()
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(rect.width)
  canvas.height = Math.ceil(rect.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 Mermaid 导出画布')

  const previewStyle = getComputedStyle(preview)
  roundedRectPath(
    context,
    previewRect.left - rect.left,
    previewRect.top - rect.top,
    previewRect.width,
    previewRect.height,
    Number.parseFloat(previewStyle.borderRadius) || 0,
  )
  context.fillStyle = previewStyle.backgroundColor
  context.fill()
  const borderWidth = Number.parseFloat(previewStyle.borderTopWidth) || 0
  if (borderWidth > 0) {
    context.strokeStyle = previewStyle.borderTopColor
    context.lineWidth = borderWidth
    context.stroke()
  }

  const serialized = svg.cloneNode(true) as SVGSVGElement
  serialized.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  serialized.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  serialized.setAttribute('width', String(svgRect.width))
  serialized.setAttribute('height', String(svgRect.height))
  serialized.style.width = `${svgRect.width}px`
  serialized.style.height = `${svgRect.height}px`
  serialized.style.maxWidth = 'none'
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(serialized),
  )}`
  await image.decode()
  context.drawImage(
    image,
    svgRect.left - rect.left,
    svgRect.top - rect.top,
    svgRect.width,
    svgRect.height,
  )
  return canvas
}

async function captureOversizedBlocks(
  session: EditorDomExportSession,
  viewportHeight: number,
): Promise<RasterBlockSnapshot[]> {
  const { default: html2canvas } = await import('html2canvas-pro')
  const rootRect = session.root.getBoundingClientRect()
  const snapshots: RasterBlockSnapshot[] = []

  for (const element of session.root.querySelectorAll<HTMLElement>(UNSPLITTABLE_BLOCK_SELECTOR)) {
    const rect = element.getBoundingClientRect()
    if (rect.height <= viewportHeight) continue
    let canvas: HTMLCanvasElement | null = null
    if (element.classList.contains('xmd-cm-mermaid-block')) {
      const source = mermaidSourceForBlock(element)
      if (source) canvas = await captureMermaidBlock(element, source)
    }
    canvas ??= await html2canvas(element, {
      allowTaint: false,
      backgroundColor: null,
      height: Math.ceil(rect.height),
      imageSmoothing: true,
      imageSmoothingQuality: 'high',
      logging: false,
      removeContainer: true,
      scale: 1,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      width: Math.ceil(rect.width),
      windowHeight: Math.max(window.innerHeight, Math.ceil(rect.height)),
      windowWidth: Math.max(window.innerWidth, Math.ceil(rect.width)),
    })
    snapshots.push({
      canvas,
      left: Math.round(rect.left - rootRect.left),
      top: Math.round(rect.top - rootRect.top),
    })
    element.style.visibility = 'hidden'
  }

  return snapshots
}

function drawBlockSnapshots(
  context: CanvasRenderingContext2D,
  snapshots: readonly RasterBlockSnapshot[],
  outputTop: number,
  rows: number,
): void {
  const outputBottom = outputTop + rows
  for (const { canvas, left, top } of snapshots) {
    const bottom = top + canvas.height
    if (bottom <= outputTop || top >= outputBottom) continue
    const sourceTop = Math.max(0, outputTop - top)
    const destinationTop = Math.max(0, top - outputTop)
    const height = Math.min(canvas.height - sourceTop, rows - destinationTop)
    context.drawImage(
      canvas,
      0,
      sourceTop,
      canvas.width,
      height,
      left,
      destinationTop,
      canvas.width,
      height,
    )
  }
}

/**
 * Creates a lazy RGBA stream. Ordinary documents keep one CM6 viewport in
 * memory. A rendered block taller than that viewport switches to CM6's print
 * DOM so its stable snapshot can be composited across multiple canvas tiles.
 */
export async function createEditorRasterImage(
  _format: ExportImageFormat,
  signal?: AbortSignal,
): Promise<RasterImageSource> {
  void _format
  const session = await createEditorDomExportSession({ signal })
  try {
    const availableViewportHeight = session.root.clientHeight
    const height = await stabilizeRasterDocument(session, availableViewportHeight, signal)
    const viewportHeight = Math.min(availableViewportHeight, height)
    if (session.root.clientHeight !== viewportHeight) {
      session.root.style.height = `${viewportHeight}px`
      session.view.requestMeasure()
    }
    const width = Math.max(1, session.root.clientWidth)
    let stableHeight = await stabilizeRasterDocument(session, viewportHeight, signal)
    const useFullRasterDom = session.requiresFullRasterDom
    if (useFullRasterDom) stableHeight = await materializeFullRasterDocument(session, signal)
    const backgroundColor = exportBackgroundColor()
    const blockSnapshots = useFullRasterDom
      ? await captureOversizedBlocks(session, viewportHeight)
      : []

    return {
      width,
      height: stableHeight,
      async *chunks() {
        if (useFullRasterDom) {
          for (let outputTop = 0; outputTop < stableHeight; outputTop += viewportHeight) {
            throwIfAborted(signal)
            const rows = Math.min(viewportHeight, stableHeight - outputTop)
            const canvas = await captureViewport(session, backgroundColor, outputTop, rows)
            try {
              const context = canvas.getContext('2d', { willReadFrequently: true })
              if (!context) throw new Error('无法读取导出图片分片')
              context.setTransform(1, 0, 0, 1, 0, 0)
              drawBlockSnapshots(context, blockSnapshots, outputTop, rows)
              yield new Uint8Array(context.getImageData(0, 0, width, rows).data)
            } finally {
              canvas.width = 1
              canvas.height = 1
            }
          }
          return
        }

        let outputTop = 0
        let preferExactTop = false
        while (outputTop < stableHeight) {
          throwIfAborted(signal)
          // Rendering a newly visible widget can refine CM6's height map and
          // nudge scrollTop. Capture with an overlap and advance by the rows we
          // actually emitted, so those corrections never create gaps or make
          // the final crop exceed its canvas.
          const actualTop = await positionOutputViewport(
            session,
            outputTop,
            viewportHeight,
            signal,
            preferExactTop,
          )
          preferExactTop = false
          const cropTop = Math.max(0, outputTop - actualTop)
          const canvas = await captureViewport(session, backgroundColor)
          try {
            throwIfAborted(signal)
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (!context) throw new Error('无法读取导出图片分片')
            const maxRows = Math.min(stableHeight - outputTop, canvas.height - cropTop)
            const rows = rowsBeforeUnsplittableBlock(
              outputTop,
              maxRows,
              viewportHeight,
              visibleUnsplittableBlocks(session),
            )
            if (actualTop > outputTop || rows <= 0) {
              throw new Error(
                `导出图片分片尺寸不一致（outputTop=${outputTop}, actualTop=${actualTop}, cropTop=${cropTop}, rows=${rows}, canvasHeight=${canvas.height}, documentHeight=${stableHeight}）`,
              )
            }
            const pixels = context.getImageData(0, cropTop, width, rows)
            yield new Uint8Array(pixels.data)
            outputTop += rows
            preferExactTop = rows < maxRows
          } finally {
            canvas.width = 1
            canvas.height = 1
          }
        }
      },
      dispose: () => {
        for (const snapshot of blockSnapshots) {
          snapshot.canvas.width = 1
          snapshot.canvas.height = 1
        }
        session.destroy()
      },
    }
  } catch (error) {
    session.destroy()
    throw error
  }
}

/** Materializes the complete CM6 DOM only for standalone HTML/PDF output. */
export async function createFullEditorDom(): Promise<HTMLElement> {
  const session = await createEditorDomExportSession()
  const printable = session.view as unknown as PrintableEditorView
  try {
    let height = documentHeight(session.view)
    // CM6 already owns a full-document render path for printing. Reuse that
    // exact path while cloning HTML instead of inventing a second Markdown
    // renderer. `printing`/`measure` are internal in CM6 6.43, so keep this
    // compatibility shim isolated and fail closed below if an upgrade changes
    // the behaviour.
    printable.viewState.printing = true
    for (let attempt = 0; attempt < 3; attempt += 1) {
      session.root.style.height = `${height}px`
      session.view.scrollDOM.scrollTop = 0
      printable.measure()
      await settleViewport(session)
      const measured = documentHeight(session.view)
      if (measured === height) break
      height = measured
    }

    if (
      session.view.viewport.from !== 0 ||
      session.view.viewport.to !== session.view.state.doc.length
    ) {
      throw new Error(
        `无法完整实例化文档 DOM（${session.view.viewport.from}-${session.view.viewport.to}/${session.view.state.doc.length}），已停止导出以避免缺失内容`,
      )
    }

    const clone = session.root.cloneNode(true) as HTMLElement
    clone.removeAttribute('aria-hidden')
    clone.style.cssText = 'position:relative;width:100%;height:auto;pointer-events:auto'
    clone.querySelector<HTMLElement>('.cm-scroller')?.style.setProperty('overflow', 'visible')
    clone.querySelector<HTMLElement>('.cm-editor')?.style.setProperty('height', 'auto')
    clone.querySelectorAll('.cm-gap').forEach((gap) => gap.remove())
    return clone
  } finally {
    printable.viewState.printing = false
    session.destroy()
  }
}
