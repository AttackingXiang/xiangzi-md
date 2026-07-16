import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createCm6Editor } from '../cm6-editor/controller'
import { cm6ExportMode } from '../cm6-editor/core/exportMode'
import { markdownEditorExportBridge } from '../cm6-editor/exportBridge'
import type { RasterImageSource } from '../../platform/contracts'
import type { ExportImageFormat } from '../../lib/exportFormat'

const CAPTURE_VIEWPORT_HEIGHT = 2_048
const ASSET_SETTLE_TIMEOUT_MS = 15_000
const FONT_SETTLE_TIMEOUT_MS = 5_000
const WARM_PASSES = 5
const CAPTURE_OVERLAP = 128

export function exportRasterViewportHeight(webViewHeight: number): number {
  if (!Number.isFinite(webViewHeight)) return 1
  return Math.max(1, Math.min(CAPTURE_VIEWPORT_HEIGHT, Math.floor(webViewHeight)))
}

interface EditorDomExportSession {
  root: HTMLElement
  view: EditorView
  destroy(): void
}

interface PrintableEditorView extends EditorView {
  viewState: { printing: boolean }
  measure(): void
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function waitForFonts(): Promise<void> {
  if (!document.fonts) return
  await Promise.race([document.fonts.ready.then(() => undefined), delay(FONT_SETTLE_TIMEOUT_MS)])
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
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  let previous = ''
  let stableFrames = 0

  while (performance.now() < deadline) {
    session.view.requestMeasure()
    await nextPaint()
    const signature = viewportSignature(session)
    const pendingImage = Array.from(session.root.querySelectorAll<HTMLImageElement>('img')).some(
      (image) => !image.complete,
    )
    const pendingMermaid = Boolean(session.root.querySelector('.xmd-cm-mermaid-preview.is-loading'))
    stableFrames = signature === previous ? stableFrames + 1 : 0
    previous = signature
    if (stableFrames >= 2 && !pendingImage && !pendingMermaid) return
    await delay(32)
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

async function scrollTo(session: EditorDomExportSession, top: number): Promise<number> {
  session.view.scrollDOM.scrollTop = Math.max(0, Math.floor(top))
  session.view.requestMeasure()
  await settleViewport(session)
  return Math.max(0, Math.floor(session.view.scrollDOM.scrollTop))
}

async function positionOutputViewport(
  session: EditorDomExportSession,
  outputTop: number,
  viewportHeight: number,
): Promise<number> {
  let desiredTop = Math.min(
    Math.max(0, outputTop - CAPTURE_OVERLAP),
    Math.max(0, session.view.scrollDOM.scrollHeight - viewportHeight),
  )
  let actualTop = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    actualTop = await scrollTo(session, desiredTop)
    if (actualTop <= outputTop && outputTop - actualTop < viewportHeight) return actualTop
    desiredTop = Math.max(0, desiredTop - Math.ceil(viewportHeight / 2))
  }
  return actualTop
}

async function stabilizeRasterDocument(
  session: EditorDomExportSession,
  viewportHeight: number,
): Promise<number> {
  await waitForFonts()
  let previousHeight = -1
  let stablePasses = 0

  for (let pass = 0; pass < WARM_PASSES; pass += 1) {
    let outputTop = 0
    let height = rasterDocumentHeight(session.view)
    while (outputTop < height) {
      const actualTop = await positionOutputViewport(session, outputTop, viewportHeight)
      const availableRows = viewportHeight - Math.max(0, outputTop - actualTop)
      if (actualTop > outputTop || availableRows <= 0) break
      outputTop += Math.min(height - outputTop, availableRows)
      height = rasterDocumentHeight(session.view)
    }

    const nextHeight = rasterDocumentHeight(session.view)
    stablePasses = nextHeight === previousHeight ? stablePasses + 1 : 0
    if (stablePasses >= 1) {
      await scrollTo(session, 0)
      return nextHeight
    }
    previousHeight = nextHeight
  }

  await scrollTo(session, 0)
  return rasterDocumentHeight(session.view)
}

async function createEditorDomExportSession(): Promise<EditorDomExportSession> {
  const snapshot = markdownEditorExportBridge.snapshot()
  if (!snapshot) throw new Error('当前没有可导出的 Markdown 编辑器')

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
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro')
  return html2canvas(session.root, {
    allowTaint: false,
    backgroundColor,
    height: session.root.clientHeight,
    imageSmoothing: true,
    imageSmoothingQuality: 'high',
    logging: false,
    removeContainer: true,
    scale: 1,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width: session.root.clientWidth,
    windowHeight: session.root.clientHeight,
    windowWidth: session.root.clientWidth,
    onclone: (clonedDocument) => {
      const clonedScroller = clonedDocument.querySelector<HTMLElement>(
        '.xmd-export-renderer .cm-scroller',
      )
      if (clonedScroller) clonedScroller.scrollTop = session.view.scrollDOM.scrollTop
    },
  })
}

/**
 * Creates a lazy RGBA stream. Only one CM6 viewport and one canvas tile exist
 * at a time; the desktop adapter writes the yielded rows to the native encoder.
 */
export async function createEditorRasterImage(
  _format: ExportImageFormat,
): Promise<RasterImageSource> {
  void _format
  const session = await createEditorDomExportSession()
  try {
    const availableViewportHeight = session.root.clientHeight
    const height = await stabilizeRasterDocument(session, availableViewportHeight)
    const viewportHeight = Math.min(availableViewportHeight, height)
    if (session.root.clientHeight !== viewportHeight) {
      session.root.style.height = `${viewportHeight}px`
      session.view.requestMeasure()
    }
    const width = Math.max(1, session.root.clientWidth)
    const stableHeight = await stabilizeRasterDocument(session, viewportHeight)
    const backgroundColor = exportBackgroundColor()

    return {
      width,
      height: stableHeight,
      async *chunks() {
        let outputTop = 0
        while (outputTop < stableHeight) {
          // Rendering a newly visible widget can refine CM6's height map and
          // nudge scrollTop. Capture with an overlap and advance by the rows we
          // actually emitted, so those corrections never create gaps or make
          // the final crop exceed its canvas.
          const actualTop = await positionOutputViewport(session, outputTop, viewportHeight)
          const cropTop = Math.max(0, outputTop - actualTop)
          const canvas = await captureViewport(session, backgroundColor)
          try {
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (!context) throw new Error('无法读取导出图片分片')
            const rows = Math.min(stableHeight - outputTop, canvas.height - cropTop)
            if (actualTop > outputTop || rows <= 0) {
              throw new Error(
                `导出图片分片尺寸不一致（outputTop=${outputTop}, actualTop=${actualTop}, cropTop=${cropTop}, rows=${rows}, canvasHeight=${canvas.height}, documentHeight=${stableHeight}）`,
              )
            }
            const pixels = context.getImageData(0, cropTop, width, rows)
            yield new Uint8Array(pixels.data)
            outputTop += rows
          } finally {
            canvas.width = 1
            canvas.height = 1
          }
        }
      },
      dispose: () => session.destroy(),
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
    await waitForFonts()
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
