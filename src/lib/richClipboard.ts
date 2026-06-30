import { desktop } from '../platform'
import { createTaskQueue } from './asyncPool'
import { blobPartFromBytes, imageMimeType, xmdAssetPaths } from './asset'
import { fitImageDimensions } from './imageBudget'
import { InFlightCache } from './inFlightCache'

interface CachedClipboardImage {
  dataUrl: string
  png: Blob
}

interface ClipboardImageRef {
  source: string
  fallback: string
}

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

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded = ''] = dataUrl.split(',', 2)
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/png'
  const binary = atob(encoded)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return new Blob([data], { type: mime })
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

function warmImage(image: HTMLImageElement): Promise<CachedClipboardImage> | null {
  const source = imageSource(image)
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

function cleanClipboardFragment(wrapper: HTMLElement): void {
  wrapper
    .querySelectorAll(
      [
        '.tools',
        '.fold-btn',
        '.milkdown-block-handle',
        '.milkdown-toolbar',
        '.milkdown-slash-menu',
        '.milkdown-link-edit',
        '.milkdown-link-preview',
      ].join(','),
    )
    .forEach((node) => node.remove())
  wrapper
    .querySelectorAll('[contenteditable]')
    .forEach((node) => node.removeAttribute('contenteditable'))
  wrapper.querySelectorAll('[spellcheck]').forEach((node) => node.removeAttribute('spellcheck'))
}

function snapshotFromSelection(root: HTMLElement): ClipboardSnapshot | null {
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
    if (originals.length === 0) return null
    singleImage = originals.length === 1 && selection.toString().trim() === ''
    if (singleImage) {
      wrapper = cloneSingleImage(originals[0])
    } else {
      wrapper = document.createElement('div')
      wrapper.appendChild(range.cloneContents())
      if (wrapper.querySelectorAll('img').length === 0) {
        originals.forEach((image) => wrapper.appendChild(image.cloneNode(false)))
      }
    }
  }

  cleanClipboardFragment(wrapper)
  const clones = Array.from(wrapper.querySelectorAll<HTMLImageElement>('img'))
  const images = clones.map((clone, index) => {
    const original = originals[index] ?? originals.find((image) => image.alt === clone.alt)
    const source = original ? imageSource(original) : clone.getAttribute('src') || ''
    if (original && !cacheRenderedImage(original)) void warmImage(original)?.catch(() => undefined)
    clone.setAttribute('src', `${PLACEHOLDER_PREFIX}${index}`)
    clone.removeAttribute('srcset')
    return { source, fallback: source }
  })

  const selectedText = selection?.toString().trim() ?? ''
  return {
    htmlTemplate: wrapper.innerHTML,
    text: selectedText || originals[0]?.alt || '',
    images,
    singleImage,
  }
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
    snapshot.images.map(({ source, fallback }) => getResolved(source)?.dataUrl ?? fallback),
  )
}

async function completeSnapshot(snapshot: ClipboardSnapshot): Promise<{
  html: string
  png?: Blob
}> {
  const cached = await Promise.all(
    snapshot.images.map(async ({ source }) => {
      const resolved = getResolved(source)
      if (resolved) return resolved
      const promise = imagePromises.get(source)
      return promise ? await promise.catch(() => null) : null
    }),
  )
  return {
    html: replaceClipboardImagePlaceholders(
      snapshot.htmlTemplate,
      snapshot.images.map(({ fallback }, index) => cached[index]?.dataUrl ?? fallback),
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
  return document.execCommand('copy')
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

export async function copyImageElement(image: HTMLImageElement): Promise<boolean> {
  const source = imageSource(image)
  if (!source) return false
  if (!cacheRenderedImage(image)) void warmImage(image)?.catch(() => undefined)
  const wrapper = cloneSingleImage(image)
  const clone = wrapper.querySelector('img')
  if (!clone) return false
  clone.setAttribute('src', `${PLACEHOLDER_PREFIX}0`)
  const snapshot: ClipboardSnapshot = {
    htmlTemplate: wrapper.innerHTML,
    text: image.alt || '',
    images: [{ source, fallback: source }],
    singleImage: true,
  }
  return writeSnapshot(snapshot)
}

/**
 * 让所见即所得编辑器复制图片的真实数据：
 * - 单图选择同时写入 image/png、HTML 和纯文本；
 * - 图文混合选择写入内嵌 data URL 的 HTML，避免只复制本地路径。
 */
export function setupRichClipboard(root: HTMLElement): () => void {
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
    const target = event.target instanceof Node ? event.target : null
    const active = document.activeElement
    if (!target || (!root.contains(target) && (!active || !root.contains(active)))) return
    const snapshot = snapshotFromSelection(root)
    if (!snapshot) return

    // 同步写入已经缓存的富文本，保证 execCommand 和受限 WebView 也有可用结果。
    event.preventDefault()
    event.clipboardData?.setData('text/html', resolvedHtml(snapshot))
    event.clipboardData?.setData('text/plain', snapshot.text)

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
