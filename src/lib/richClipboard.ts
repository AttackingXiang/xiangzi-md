import { desktop } from '../platform'
import { getClipboardFormat, getImageCopyMode, getMermaidCopyMode } from './copyPreferences'
import { renderMermaidForExport } from './mermaidPreview'
import { createTaskQueue } from './asyncPool'
import { blobPartFromBytes, imageMimeType, xmdAssetPaths } from './asset'
import { fitImageDimensions } from './imageDimensions'
import { InFlightCache } from './inFlightCache'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import { materializePortableClipboard, portableClipboardText } from './portableClipboard'
import { markdownToPortableHtml } from './markdownClipboard'

interface CachedClipboardImage {
  dataUrl: string
  png: Blob
}

interface ClipboardImageRef {
  source: string
  fallback: string
  pendingSource?: Promise<string | null>
  /** 若存在，该条目其实是一张 Mermaid 图表：resolve 时用源码栅格化成 PNG，
   * 而不是按 source 读取文件/网络图片。 */
  mermaid?: { code: string; bg: string }
}

type ClipboardImageResolver = (source: string) => Promise<string | null> | string | null

interface ClipboardSnapshot {
  htmlTemplate: string
  text: string
  images: ClipboardImageRef[]
  singleImage: boolean
}

const PLACEHOLDER_PREFIX = 'xmd-copy-image-'
const MAX_CACHE_ENTRIES = 12
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_CLIPBOARD_IMAGE_PIXELS = 16_000_000
const MAX_IN_FLIGHT_IMAGES = 16
const imagePromises = new InFlightCache<string, CachedClipboardImage>()
const resolvedImages = new Map<string, CachedClipboardImage>()
const imageTaskQueue = createTaskQueue(2)
let legacyWriteInProgress = false

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded = ''] = dataUrl.split(',', 2)
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/png'
  const binary = atob(encoded)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return new Blob([data], { type: mime })
}

function cacheSize(image: CachedClipboardImage): number {
  return image.dataUrl.length * 2 + image.png.size
}

function ensureBlobWithinBudget(blob: Blob): Blob {
  if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('图片超过 32 MB，已停止预加载')
  }
  return blob
}

function putResolved(source: string, image: CachedClipboardImage): void {
  resolvedImages.delete(source)
  resolvedImages.set(source, image)
  let size = Array.from(resolvedImages.values()).reduce(
    (total, cached) => total + cacheSize(cached),
    0,
  )
  while (resolvedImages.size > MAX_CACHE_ENTRIES || size > MAX_CACHE_BYTES) {
    const oldest = resolvedImages.entries().next().value
    if (!oldest) break
    resolvedImages.delete(oldest[0])
    size -= cacheSize(oldest[1])
  }
}

function getResolved(source: string): CachedClipboardImage | undefined {
  const image = resolvedImages.get(source)
  if (image) putResolved(source, image)
  return image
}

// ── Mermaid 图表栅格化缓存 ────────────────────────────────────────────────
// 复制含 Mermaid 的选区（且「Mermaid 复制为=图片」）时，用源码重新渲染出纯 SVG
// 再栅格成 PNG，缓存起来供剪贴板 HTML 内嵌。按 源码+底色 做键。
const mermaidResolved = new Map<string, CachedClipboardImage>()
const mermaidPromises = new InFlightCache<string, CachedClipboardImage>()

function mermaidKey(code: string, bg: string): string {
  return `${bg}\u0000${code}`
}

function getResolvedMermaid(code: string, bg: string): CachedClipboardImage | undefined {
  return mermaidResolved.get(mermaidKey(code, bg))
}

function resolveMermaid(code: string, bg: string): Promise<CachedClipboardImage> {
  const key = mermaidKey(code, bg)
  const cached = mermaidResolved.get(key)
  if (cached) return Promise.resolve(cached)
  return mermaidPromises.getOrCreate(key, () =>
    imageTaskQueue.run(async () => {
      const svg = await renderMermaidForExport(code)
      const png = await svgMarkupToPng(svg, bg)
      if (!png) throw new Error('Mermaid 栅格化失败')
      const result = { dataUrl: await blobToDataUrl(png), png }
      mermaidResolved.set(key, result)
      if (mermaidResolved.size > MAX_CACHE_ENTRIES) {
        const oldest = mermaidResolved.keys().next().value
        if (oldest !== undefined) mermaidResolved.delete(oldest)
      }
      return result
    }),
  )
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute('src') || ''
}

/** 将自定义 xmd:// 图片地址还原成已由工作区授权的本地路径。 */
export function localImagePath(source: string): string | null {
  return xmdAssetPaths(source)[0] ?? null
}

async function readLocalImage(
  paths: readonly string[],
): Promise<{ bytes: Uint8Array; path: string }> {
  let failure: unknown
  for (const path of paths) {
    try {
      return { bytes: await desktop.readBinaryFile(path), path }
    } catch (error) {
      failure = error
    }
  }
  throw failure instanceof Error ? failure : new Error('找不到本地图片')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('图片读取结果无效'))
      },
      { once: true },
    )
    reader.addEventListener('error', () => reject(reader.error ?? new Error('图片读取失败')), {
      once: true,
    })
    reader.readAsDataURL(blob)
  })
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片转换失败'))), 'image/png')
  })
}

async function toPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  let canvas: HTMLCanvasElement | undefined
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => reject(new Error('图片解码失败')), { once: true })
      image.src = url
    })
    const dimensions = fitImageDimensions(
      image.naturalWidth,
      image.naturalHeight,
      MAX_CLIPBOARD_IMAGE_PIXELS,
    )
    if (
      blob.type === 'image/png' &&
      dimensions.width === image.naturalWidth &&
      dimensions.height === image.naturalHeight
    ) {
      return blob
    }
    canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    return await canvasToPng(canvas)
  } finally {
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
    URL.revokeObjectURL(url)
  }
}

/** 已显示的同源图片可在 copy 事件内同步转成 PNG，兼容不支持异步 ClipboardItem 的 WebView。 */
function cacheRenderedImage(image: HTMLImageElement): CachedClipboardImage | null {
  const source = imageSource(image)
  const existing = getResolved(source)
  if (existing) return existing
  if (!source || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null
  let canvas: HTMLCanvasElement | undefined
  try {
    const dimensions = fitImageDimensions(
      image.naturalWidth,
      image.naturalHeight,
      MAX_CLIPBOARD_IMAGE_PIXELS,
    )
    canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    const dataUrl = canvas.toDataURL('image/png')
    const cached = { dataUrl, png: dataUrlToBlob(dataUrl) }
    putResolved(source, cached)
    return cached
  } catch {
    // 跨域图片可能污染 canvas，后续由 fetch 异步路径继续尝试。
    return null
  } finally {
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}

function warmImageSource(source: string): Promise<CachedClipboardImage> | null {
  if (!source) return null
  const existing = imagePromises.get(source)
  if (existing) return existing
  if (imagePromises.size >= MAX_IN_FLIGHT_IMAGES) return null

  const localPaths = xmdAssetPaths(source)
  return imagePromises.getOrCreate(source, () =>
    imageTaskQueue.run(async () => {
      const blob = localPaths.length
        ? await readLocalImage(localPaths).then(({ bytes, path }) =>
            ensureBlobWithinBudget(
              new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(path) }),
            ),
          )
        : await fetch(source).then(async (response) => {
            if (!response.ok) throw new Error(`图片读取失败：${response.status}`)
            const declaredSize = Number(response.headers.get('content-length') ?? 0)
            if (declaredSize > MAX_CLIPBOARD_IMAGE_BYTES) {
              throw new Error('图片超过 32 MB，已停止预加载')
            }
            return ensureBlobWithinBudget(await response.blob())
          })
      const dataUrl = await blobToDataUrl(blob)
      const png = await toPng(blob)
      const cached = { dataUrl, png }
      putResolved(source, cached)
      return cached
    }),
  )
}

function warmImage(image: HTMLImageElement): Promise<CachedClipboardImage> | null {
  return warmImageSource(imageSource(image))
}

function cloneSingleImage(image: HTMLImageElement): HTMLElement {
  const wrapper = document.createElement('div')
  const clone = image.cloneNode(false) as HTMLImageElement
  clone.removeAttribute('srcset')
  wrapper.appendChild(clone)
  return wrapper
}

function selectionInside(root: HTMLElement, selection: Selection): boolean {
  if (selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  return root.contains(range.commonAncestorContainer)
}

function imagesIntersectingRange(root: HTMLElement, range: Range): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter((image) => {
    try {
      return range.intersectsNode(image)
    } catch {
      return false
    }
  })
}

/** 与选区相交、且处于图表形态（含 .xmd-mermaid-preview）的 Mermaid 代码块。 */
function mermaidBlocksIntersectingRange(root: HTMLElement, range: Range): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.xmd-code-block')).filter((block) => {
    if (!block.querySelector('.xmd-mermaid-preview')) return false
    try {
      return range.intersectsNode(block)
    } catch {
      return false
    }
  })
}

/** 图表栅格化时补的底色：跟随当前主题的代码卡片底色，与预览一致。 */
function mermaidBackground(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--code-card-bg').trim() ||
    '#f7f7f7'
  )
}

function mermaidCodeOf(block: Element): string {
  return block.querySelector('.xmd-code-content, code')?.textContent ?? ''
}

function selectedNodeImages(root: HTMLElement): HTMLImageElement[] {
  const selected = root.querySelectorAll<HTMLElement>(
    [
      '.ProseMirror-selectednode',
      '.image-wrapper.ProseMirror-selectednode',
      '.milkdown-image-inline.ProseMirror-selectednode',
      // Milkdown Crepe 7 的块图片使用自身的 selected 类表示 NodeSelection。
      '.milkdown-image-block.selected',
      '.milkdown-image-inline.selected',
    ].join(','),
  )
  const images: HTMLImageElement[] = []
  selected.forEach((node) => {
    if (node instanceof HTMLImageElement) images.push(node)
    node.querySelectorAll<HTMLImageElement>('img').forEach((image) => images.push(image))
  })
  return [...new Set(images)]
}

/**
 * 复制富文本快路径序列化的是「渲染 DOM」，里面混着 nodeView 注入的、并不属于
 * 文档内容的装饰节点。这些必须在写进剪贴板前剥掉，否则会把编辑器的 UI chrome
 * 当作正文带到别的应用里。
 */
export const CLIPBOARD_CHROME_SELECTOR = [
  '.tools',
  '.fold-btn',
  '.milkdown-block-handle',
  '.milkdown-toolbar',
  '.milkdown-slash-menu',
  '.milkdown-link-edit',
  '.milkdown-link-preview',
  // 有序编号 / 项目符号 / 任务勾选框由 Crepe 的 list-item nodeView 以真实文本节点
  // 渲染（<span class="label">1.</span>）。若不剥掉，复制到别处会把 “1.”“⦿”“☑”
  // 当字面文本带出去，与目标 <ol>/<ul> 自身的原生编号叠加成重复。列表结构本身仍在
  // <li> 上，编号交给目标渲染。
  '.label-wrapper',
  // 代码块 nodeView 的头部（语言选择按钮、复制按钮等 chrome）同样非文档内容。
  '.xmd-code-header',
  // CodeMirror uses zero-sized image nodes around replacement decorations.
  // They are cursor-mapping sentinels, not document images.
  '.cm-widgetBuffer',
  '.cm-gap',
  // CM6 preview controls are useful in the editor but must never be pasted as
  // buttons alongside the rendered formula/diagram/table.
  '.xmd-cm-code-preview-header',
  '.xmd-cm-code-scrollbar',
  '.xmd-cm-math-actions',
  '.xmd-cm-mermaid-actions',
  '.xmd-cm-table-menu',
  '.xmd-cm-mermaid-preview-toggle',
  '.xmd-cm-math-preview-toggle',
].join(',')

export function cleanClipboardFragment(wrapper: HTMLElement): void {
  wrapper.querySelectorAll(CLIPBOARD_CHROME_SELECTOR).forEach((node) => node.remove())
  wrapper
    .querySelectorAll('[contenteditable]')
    .forEach((node) => node.removeAttribute('contenteditable'))
  wrapper.querySelectorAll('[spellcheck]').forEach((node) => node.removeAttribute('spellcheck'))
}

function prepareSnapshot(
  wrapper: HTMLElement,
  originals: HTMLImageElement[],
  text: string,
  singleImage: boolean,
  resolveImageSource?: ClipboardImageResolver,
): ClipboardSnapshot {
  cleanClipboardFragment(wrapper)
  materializePortableClipboard(wrapper)

  // Mermaid 先处理：把每个图表代码块整块换成占位 <img>，并打标记，避免下面
  // 统计真实图片时把图表里可能内嵌的 <img> 也算进去、错乱占位序号。
  const mermaidRefs: ClipboardImageRef[] = []
  if (getMermaidCopyMode() === 'image') {
    const bg = mermaidBackground()
    wrapper
      .querySelectorAll<HTMLElement>(
        '.xmd-code-block, .xmd-cm-mermaid-block, [data-xmd-mermaid-block]',
      )
      .forEach((block) => {
        const modelBlock = block.hasAttribute('data-xmd-mermaid-block')
        if (!modelBlock && !block.querySelector('.xmd-mermaid-preview, .xmd-cm-mermaid-preview')) {
          return
        }
        const code = mermaidCodeOf(block)
        if (!code.trim()) return
        const placeholder = document.createElement('img')
        placeholder.setAttribute('data-xmd-mermaid', String(mermaidRefs.length))
        block.replaceWith(placeholder)
        mermaidRefs.push({ source: mermaidKey(code, bg), fallback: '', mermaid: { code, bg } })
        void resolveMermaid(code, bg).catch(() => undefined)
      })
  }
  wrapper
    .querySelectorAll<HTMLElement>('[data-xmd-mermaid-block]')
    .forEach((block) => block.removeAttribute('data-xmd-mermaid-block'))

  const clones = Array.from(wrapper.querySelectorAll<HTMLImageElement>('img')).filter(
    (img) => img.getAttribute('data-xmd-mermaid') === null,
  )
  const images: ClipboardImageRef[] = clones.map((clone, index) => {
    const original = originals[index] ?? originals.find((image) => image.alt === clone.alt)
    const rawSource = original ? imageSource(original) : clone.getAttribute('src') || ''
    let source = rawSource
    let pendingSource: Promise<string | null> | undefined
    if (!original && resolveImageSource) {
      try {
        const resolved = resolveImageSource(rawSource)
        if (typeof resolved === 'string') source = resolved || rawSource
        else if (resolved) pendingSource = Promise.resolve(resolved)
      } catch {
        // Keep the Markdown source as a graceful fallback when resolution fails.
      }
    }
    if (original) {
      if (!cacheRenderedImage(original)) void warmImage(original)?.catch(() => undefined)
    } else if (pendingSource) {
      void pendingSource
        .then((resolved) => warmImageSource(resolved || rawSource)?.catch(() => undefined))
        .catch(() => undefined)
    } else {
      void warmImageSource(source)?.catch(() => undefined)
    }
    clone.setAttribute('src', `${PLACEHOLDER_PREFIX}${index}`)
    clone.removeAttribute('srcset')
    return { source, fallback: source, ...(pendingSource ? { pendingSource } : {}) }
  })
  // Mermaid 占位图接在真实图片之后拿序号，写回真正的占位 src。
  mermaidRefs.forEach((ref, i) => {
    const index = images.length
    const el = wrapper.querySelector<HTMLImageElement>(`img[data-xmd-mermaid="${i}"]`)
    el?.setAttribute('src', `${PLACEHOLDER_PREFIX}${index}`)
    el?.removeAttribute('data-xmd-mermaid')
    images.push(ref)
  })

  return {
    htmlTemplate: wrapper.innerHTML,
    text: text.trim() || originals[0]?.alt || '',
    images,
    singleImage,
  }
}

function snapshotFromSelection(root: HTMLElement, allowTextOnly = false): ClipboardSnapshot | null {
  const selection = window.getSelection()
  const explicitlySelected = selectedNodeImages(root)
  if (explicitlySelected.length === 0 && (!selection || !selectionInside(root, selection))) {
    return null
  }
  let originals: HTMLImageElement[]
  let wrapper: HTMLElement
  let singleImage = false

  if (explicitlySelected.length > 0) {
    originals = explicitlySelected
    singleImage = originals.length === 1
    wrapper = singleImage ? cloneSingleImage(originals[0]) : document.createElement('div')
    if (!singleImage) originals.forEach((image) => wrapper.appendChild(image.cloneNode(false)))
  } else {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    originals = imagesIntersectingRange(root, range)
    // 「Mermaid 复制为=图片」时，选区里的图表也算“可复制成图片”的内容——即便一
    // 张普通图片都没有，也要接管这次复制，而不是让编辑器落回复制源码。
    const hasMermaid =
      getMermaidCopyMode() === 'image' && mermaidBlocksIntersectingRange(root, range).length > 0
    if (originals.length === 0 && !hasMermaid && !allowTextOnly) return null
    singleImage = originals.length === 1 && !hasMermaid && selection.toString().trim() === ''
    if (singleImage) {
      wrapper = cloneSingleImage(originals[0])
    } else {
      wrapper = document.createElement('div')
      wrapper.appendChild(range.cloneContents())
      if (originals.length > 0 && wrapper.querySelectorAll('img').length === 0) {
        originals.forEach((image) => wrapper.appendChild(image.cloneNode(false)))
      }
    }
  }

  return prepareSnapshot(wrapper, originals, selection?.toString() ?? '', singleImage)
}

function wholeCm6DocumentSelected(root: HTMLElement): boolean {
  const view = cm6ActiveViewBridge.get()
  if (!view || !root.contains(view.dom) || view.state.doc.length === 0) return false
  const ranges = view.state.selection.ranges
  const range = ranges[0]
  return ranges.length === 1 && range?.from === 0 && range.to === view.state.doc.length
}

function wholeMarkdownWrapper(): HTMLElement | null {
  const view = cm6ActiveViewBridge.get()
  if (!view) return null
  const wrapper = document.createElement('div')
  wrapper.innerHTML = markdownToPortableHtml(view.state.doc.toString())
  return wrapper
}

function snapshotFromWholeMarkdown(
  resolveImageSource?: ClipboardImageResolver,
): ClipboardSnapshot | null {
  const wrapper = wholeMarkdownWrapper()
  if (!wrapper) return null
  return prepareSnapshot(wrapper, [], portableClipboardText(wrapper), false, resolveImageSource)
}

function textFromWholeMarkdown(): string | null {
  const wrapper = wholeMarkdownWrapper()
  return wrapper ? portableClipboardText(wrapper) : null
}

function textFromSelection(root: HTMLElement): string | null {
  const selectedImages = selectedNodeImages(root)
  if (selectedImages.length > 0) {
    return selectedImages
      .map((image) => image.alt)
      .filter(Boolean)
      .join('\n')
  }
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selectionInside(root, selection)) return null
  return selection.toString().trim()
}

export function replaceClipboardImagePlaceholders(
  htmlTemplate: string,
  sources: readonly string[],
): string {
  return sources.reduce(
    (html, source, index) => html.split(`${PLACEHOLDER_PREFIX}${index}`).join(source),
    htmlTemplate,
  )
}

function resolvedHtml(snapshot: ClipboardSnapshot): string {
  return replaceClipboardImagePlaceholders(
    snapshot.htmlTemplate,
    snapshot.images.map((ref) =>
      ref.mermaid
        ? (getResolvedMermaid(ref.mermaid.code, ref.mermaid.bg)?.dataUrl ?? ref.fallback)
        : (getResolved(ref.source)?.dataUrl ?? ref.fallback),
    ),
  )
}

async function completeSnapshot(snapshot: ClipboardSnapshot): Promise<{
  html: string
  png?: Blob
}> {
  const cached = await Promise.all(
    snapshot.images.map(async (ref) => {
      if (ref.mermaid) {
        return await resolveMermaid(ref.mermaid.code, ref.mermaid.bg).catch((error: unknown) => {
          console.error('Mermaid 剪贴板图片解析失败', error)
          return null
        })
      }
      const source = (await ref.pendingSource?.catch(() => null)) || ref.source
      ref.source = source
      ref.fallback = source
      const resolved = getResolved(source)
      if (resolved) return resolved
      const promise = imagePromises.get(source) ?? warmImageSource(source)
      return promise ? await promise.catch(() => null) : null
    }),
  )
  return {
    html: replaceClipboardImagePlaceholders(
      snapshot.htmlTemplate,
      snapshot.images.map((ref, index) => cached[index]?.dataUrl ?? ref.fallback),
    ),
    png: snapshot.singleImage ? cached[0]?.png : undefined,
  }
}

function legacyWrite(html: string, text: string): boolean {
  const onCopy = (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    event.clipboardData?.setData('text/html', html)
    event.clipboardData?.setData('text/plain', text)
  }
  document.addEventListener('copy', onCopy, { capture: true, once: true })
  legacyWriteInProgress = true
  try {
    return document.execCommand('copy')
  } finally {
    legacyWriteInProgress = false
  }
}

async function writeSnapshot(snapshot: ClipboardSnapshot): Promise<boolean> {
  const complete = await completeSnapshot(snapshot)
  if ('__TAURI_INTERNALS__' in window) {
    try {
      if (snapshot.singleImage && complete.png) {
        await desktop.writeClipboardImage(new Uint8Array(await complete.png.arrayBuffer()))
      } else {
        await desktop.writeClipboardHtml(complete.html, snapshot.text)
      }
      return true
    } catch {
      // 原生剪贴板不可用时继续使用 Web Clipboard / copy 事件回退。
    }
  }
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const data: Record<string, Blob> = {
      'text/html': new Blob([complete.html], { type: 'text/html' }),
      'text/plain': new Blob([snapshot.text], { type: 'text/plain' }),
    }
    if (complete.png) data['image/png'] = complete.png
    try {
      await navigator.clipboard.write([new ClipboardItem(data)])
      return true
    } catch {
      // WebView/系统剪贴板不允许异步二进制写入时，回退到同步 HTML。
    }
  }
  return legacyWrite(complete.html, snapshot.text)
}

/** Rasterize SVG markup without foreignObject content into a bounded PNG. */
export async function svgMarkupToPng(
  svgMarkup: string,
  backgroundColor: string,
  scale = 2,
): Promise<Blob | null> {
  const holder = document.createElement('div')
  holder.innerHTML = svgMarkup
  const svg = holder.querySelector('svg')
  if (!svg) return null
  const viewBox = svg.viewBox.baseVal
  const width = Math.max(1, Math.round(viewBox?.width || Number(svg.getAttribute('width')) || 800))
  const height = Math.max(
    1,
    Math.round(viewBox?.height || Number(svg.getAttribute('height')) || 600),
  )
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.style.maxWidth = ''

  const serialized = new XMLSerializer().serializeToString(svg)
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  let canvas: HTMLCanvasElement | undefined
  try {
    const image = new Image()
    image.decoding = 'async'
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => reject(new Error('图表转换失败')), { once: true })
        image.src = url
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('图表图片解码超时')), 5000)
      }),
    ])
    const dimensions = fitImageDimensions(width * scale, height * scale, MAX_CLIPBOARD_IMAGE_PIXELS)
    canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.fillStyle = backgroundColor
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    return dataUrlToBlob(canvas.toDataURL('image/png'))
  } finally {
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
    URL.revokeObjectURL(url)
  }
}

/**
 * 把一段 SVG 标记（如 mermaid 重新渲染出的导出专用 SVG）栅格化为 PNG 并写入
 * 系统剪贴板，让图表预览态的「复制」得到可粘贴进 Word/微信等应用的真实图片。
 * 剪贴板优先走 Tauri 原生通道：它不依赖浏览器的「用户手势有效期」，异步栅格
 * 化完成后写入依然可靠；Web Clipboard 仅作后备。
 */
export async function copySvgMarkupAsImage(
  svgMarkup: string,
  backgroundColor: string,
  scale = 2,
): Promise<boolean> {
  const png = await svgMarkupToPng(svgMarkup, backgroundColor, scale)
  if (!png) return false
  try {
    // Do not infer the runtime from a private Tauri global. Its spelling and
    // injection timing differ between WebView versions. The adapter is the
    // capability boundary: in a browser it rejects and we continue below.
    await desktop.writeClipboardImage(new Uint8Array(await png.arrayBuffer()))
    return true
  } catch {
    // 原生剪贴板不可用时继续尝试 Web Clipboard。
  }
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      return true
    } catch {
      // 两条路径都不可用时放弃，调用方保留复制源码文本的兜底。
    }
  }
  return false
}

export async function copyImageElement(image: HTMLImageElement): Promise<boolean> {
  const source = imageSource(image)
  if (!source) return false

  // This API backs an explicit "copy image" action. Unlike selection copy it
  // must never silently degrade to an <img> URL or alt text while claiming the
  // image was copied. Wait for the real pixels and report failure otherwise.
  let resolved = cacheRenderedImage(image) ?? getResolved(source)
  if (!resolved) {
    const pending = warmImage(image)
    if (pending) resolved = await pending.catch(() => undefined)
  }
  if (!resolved?.png) return false

  try {
    await desktop.writeClipboardImage(new Uint8Array(await resolved.png.arrayBuffer()))
    return true
  } catch {
    // Browser preview/tests do not provide the native adapter; use the standard
    // binary Clipboard API there, but deliberately do not fall back to text.
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': resolved.png })])
    return true
  } catch {
    return false
  }
}

/**
 * 让所见即所得编辑器复制图片的真实数据：
 * - 单图选择同时写入 image/png、HTML 和纯文本；
 * - 图文混合选择写入内嵌 data URL 的 HTML，避免只复制本地路径。
 */
export function setupRichClipboard(
  root: HTMLElement,
  resolveImageSource?: ClipboardImageResolver,
): () => void {
  const observedImages = new WeakSet<HTMLImageElement>()
  const intersection =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || !(entry.target instanceof HTMLImageElement)) return
            const image = entry.target
            intersection?.unobserve(image)
            if (!cacheRenderedImage(image)) void warmImage(image)?.catch(() => undefined)
          })
        })
  const observeImages = (): void => {
    root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      if (observedImages.has(image)) return
      observedImages.add(image)
      image.loading = 'lazy'
      image.decoding = 'async'
      intersection?.observe(image)
    })
  }
  observeImages()
  const observer = new MutationObserver(observeImages)
  observer.observe(root, { childList: true, subtree: true })

  const warmPointerImage = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const image =
      event.target instanceof HTMLImageElement
        ? event.target
        : event.target
            .closest('.image-wrapper, .milkdown-image-inline')
            ?.querySelector<HTMLImageElement>('img')
    if (image && !cacheRenderedImage(image)) void warmImage(image)?.catch(() => undefined)
  }
  root.addEventListener('pointerdown', warmPointerImage, true)
  root.addEventListener('mouseover', warmPointerImage, true)

  const onCopy = (event: ClipboardEvent): void => {
    if (legacyWriteInProgress) return
    const target = event.target instanceof Node ? event.target : null
    const active = document.activeElement
    if (!target || (!root.contains(target) && (!active || !root.contains(active)))) return
    const wholeDocument = wholeCm6DocumentSelected(root)
    if (getClipboardFormat() === 'plain') {
      const text = wholeDocument
        ? (textFromWholeMarkdown() ?? textFromSelection(root))
        : textFromSelection(root)
      if (text === null) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', text)
      return
    }
    // 「复制地址」模式：图片不拦截，交给编辑器复制 ![alt](路径) 这类文本引用。
    // 但「Mermaid 复制为=图片」与图片开关相互独立——选区里若有要转成图片的图表，
    // 仍需接管。纯文字选区不受图片偏好影响，继续走富文本序列化。
    if (!wholeDocument && getImageCopyMode() === 'address') {
      const sel = window.getSelection()
      const selectedImages = selectedNodeImages(root)
      const hasImage =
        selectedImages.length > 0 ||
        (!!sel && sel.rangeCount > 0 && imagesIntersectingRange(root, sel.getRangeAt(0)).length > 0)
      const hasMermaid =
        getMermaidCopyMode() === 'image' &&
        !!sel &&
        sel.rangeCount > 0 &&
        mermaidBlocksIntersectingRange(root, sel.getRangeAt(0)).length > 0
      if (hasImage && !hasMermaid) return
    }
    const snapshot = wholeDocument
      ? (snapshotFromWholeMarkdown(resolveImageSource) ?? snapshotFromSelection(root, true))
      : snapshotFromSelection(root, true)
    if (!snapshot) return

    // 同步写入已经缓存的富文本，保证 execCommand 和受限 WebView 也有可用结果。
    event.preventDefault()
    event.clipboardData?.setData('text/html', resolvedHtml(snapshot))
    event.clipboardData?.setData('text/plain', snapshot.text)

    if (wholeDocument) {
      // The model-derived HTML is complete and must never be replaced with a
      // CM6 DOM snapshot. Resource completion may safely rewrite the same
      // snapshot later because it only resolves its image placeholders and
      // Mermaid renders; headings/lists/text still come from the full model.
      if (snapshot.images.length > 0) {
        window.setTimeout(() => {
          void writeSnapshot(snapshot).catch((error: unknown) =>
            console.error('写入完整文档剪贴板资源失败', error),
          )
        }, 0)
      }
      return
    }

    // WebKit 会在 copy 事件返回后才提交 event.clipboardData；下一任务再写原生
    // 剪贴板，避免 WebKit 用空的 WebArchive 覆盖最终图片/富文本。
    window.setTimeout(() => {
      void writeSnapshot(snapshot).catch((error: unknown) =>
        console.error('写入图片剪贴板失败', error),
      )
    }, 0)
  }
  document.addEventListener('copy', onCopy, true)

  return () => {
    observer.disconnect()
    intersection?.disconnect()
    root.removeEventListener('pointerdown', warmPointerImage, true)
    root.removeEventListener('mouseover', warmPointerImage, true)
    document.removeEventListener('copy', onCopy, true)
  }
}
