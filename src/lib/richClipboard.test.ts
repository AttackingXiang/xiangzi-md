// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCopyPreferences } from './copyPreferences'
import { subscribeCopyFeedback, type CopyFeedbackFormat } from './copyFeedback'

const desktop = vi.hoisted(() => ({
  readBinaryFile: vi.fn(),
  writeClipboardImage: vi.fn(),
  writeClipboardHtml: vi.fn(),
}))
vi.mock('../platform', () => ({ desktop }))

const mermaidPreview = vi.hoisted(() => ({ renderMermaidForExport: vi.fn() }))
// mermaid is a heavy dynamic import; richClipboard only needs its resolved SVG
// markup, so stub the renderer instead of pulling the real library into tests.
vi.mock('./mermaidPreview', () => mermaidPreview)

import {
  CLIPBOARD_CHROME_SELECTOR,
  cleanClipboardFragment,
  copyImageElement,
  copySvgMarkupAsImage,
  localImagePath,
  replaceClipboardImagePlaceholders,
  setupRichClipboard,
  svgMarkupToPng,
} from './richClipboard'

interface FakeCanvasContext {
  drawImage: ReturnType<typeof vi.fn>
  fillRect: ReturnType<typeof vi.fn>
  fillStyle: string
}

function fakeCanvasContext(): FakeCanvasContext {
  return { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
}

/** Installs a canvas 2D context stub: happy-dom's `getContext('2d')` always
 * returns null, so every canvas-drawing path under test needs a stand-in. */
function stubCanvas(): FakeCanvasContext {
  const context = fakeCanvasContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`,
  )
  return context
}

let imageOutcome: 'load' | 'error' = 'load'

/** happy-dom never fires `load`/`error` for an <img> pointed at a blob: or
 * data: URL — there is no real decoder behind it, unlike every WebView this
 * app ships on. Rasterization code that awaits image decode would otherwise
 * hang forever, so tests that exercise it install this stand-in decoder. */
class AutoSettleImage extends EventTarget {
  decoding = 'async'
  naturalWidth = 640
  naturalHeight = 480
  private srcValue = ''
  get src(): string {
    return this.srcValue
  }
  set src(value: string) {
    this.srcValue = value
    queueMicrotask(() => this.dispatchEvent(new Event(imageOutcome)))
  }
}

/** For the decode-timeout branch: an <img> whose src setter never settles. */
class NeverSettleImage extends EventTarget {
  decoding = 'async'
  src = ''
}

function mountRoot(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

function selectContents(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function dispatchCopy(target: HTMLElement, clipboardData: DataTransfer): ClipboardEvent {
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData })
  target.dispatchEvent(event)
  return event
}

function markAsSelectedImage(image: HTMLImageElement): void {
  image.classList.add('ProseMirror-selectednode')
}

function makeRenderedImage(src: string): HTMLImageElement {
  const image = document.createElement('img')
  image.setAttribute('src', src)
  Object.defineProperty(image, 'complete', { value: true, configurable: true })
  Object.defineProperty(image, 'naturalWidth', { value: 640, configurable: true })
  Object.defineProperty(image, 'naturalHeight', { value: 480, configurable: true })
  return image
}

// setupRichClipboard registers a document-level 'copy' listener. If a test
// fails an assertion before reaching its own cleanup call, that listener
// would otherwise keep firing in every later test. Track every disposer here
// so a failure in one test can never leak into the next.
const activeDisposers: Array<() => void> = []

function setup(
  root: HTMLElement,
  resolveImageSource?: (source: string) => string | null,
): () => void {
  const dispose = setupRichClipboard(root, resolveImageSource)
  activeDisposers.push(dispose)
  return dispose
}

afterEach(() => {
  activeDisposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  setCopyPreferences({
    clipboardFormat: 'rich',
    imageCopyMode: 'image',
    mermaidCopyMode: 'image',
    copyTextColor: false,
    copyHighlightColor: false,
  })
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  imageOutcome = 'load'
})

describe('localImagePath', () => {
  it('decodes macOS and Windows paths from the xmd protocol', () => {
    expect(localImagePath('xmd://localhost/%2FVolumes%2FNotes%2Fimage.png')).toBe(
      '/Volumes/Notes/image.png',
    )
    expect(localImagePath('xmd://localhost/C%3A%5CNotes%5Cimage.png')).toBe('C:\\Notes\\image.png')
  })

  it('does not treat a remote image as a local file', () => {
    expect(localImagePath('https://example.com/image.png')).toBeNull()
  })
})

describe('cleanClipboardFragment', () => {
  it('strips nodeView chrome elements while keeping document content', () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML =
      '<div class="tools">toolbar</div>' +
      '<div class="milkdown-slash-menu">menu</div>' +
      '<span class="xmd-cm-code-preview-header">header</span>' +
      '<p>keep me</p>'
    cleanClipboardFragment(wrapper)
    expect(wrapper.querySelector('.tools')).toBeNull()
    expect(wrapper.querySelector('.milkdown-slash-menu')).toBeNull()
    expect(wrapper.querySelector('.xmd-cm-code-preview-header')).toBeNull()
    expect(wrapper.querySelector('p')?.textContent).toBe('keep me')
  })

  it('removes contenteditable and spellcheck attributes left by nodeViews', () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<p contenteditable="true" spellcheck="false">text</p>'
    cleanClipboardFragment(wrapper)
    const paragraph = wrapper.querySelector('p')
    expect(paragraph?.hasAttribute('contenteditable')).toBe(false)
    expect(paragraph?.hasAttribute('spellcheck')).toBe(false)
  })

  it('keeps stripping the pre-existing editor overlays and virtualization artifacts', () => {
    for (const selector of [
      '.milkdown-block-handle',
      '.milkdown-toolbar',
      '.fold-btn',
      '.label-wrapper',
      '.xmd-code-header',
      '.cm-widgetBuffer',
      '.cm-gap',
      '.xmd-cm-mermaid-actions',
    ]) {
      expect(CLIPBOARD_CHROME_SELECTOR).toContain(selector)
    }
  })
})

describe('replaceClipboardImagePlaceholders', () => {
  it('substitutes each numbered placeholder with its resolved source in order', () => {
    const html = '<p>before<img src="xmd-copy-image-0">middle<img src="xmd-copy-image-1">after</p>'
    expect(
      replaceClipboardImagePlaceholders(html, [
        'data:image/png;base64,AAAA',
        'data:image/jpeg;base64,BBBB',
      ]),
    ).toBe(
      '<p>before<img src="data:image/png;base64,AAAA">middle<img src="data:image/jpeg;base64,BBBB">after</p>',
    )
  })

  it('leaves unrelated HTML unchanged when there are no images to resolve', () => {
    expect(replaceClipboardImagePlaceholders('<p>text only</p>', [])).toBe('<p>text only</p>')
  })

  // 回归：`xmd-copy-image-1` 是 `xmd-copy-image-10` 的前缀。按下标顺序做 split/join 时，
  // 处理到 1 会先吃掉 10 的前半段，把第 10 张之后的 src 污染成「第 1 张的地址 + 残留数字」。
  // 一次选区里复制 10 张以上图片就会触发，而且是静默的——剪贴板里拿到的是坏地址。
  it('does not let a low-index placeholder corrupt one whose index shares its prefix', () => {
    const sources = Array.from({ length: 11 }, (_, index) => `file:///photo-${index}.png`)
    expect(
      replaceClipboardImagePlaceholders(
        '<img src="xmd-copy-image-1"><img src="xmd-copy-image-10">',
        sources,
      ),
    ).toBe('<img src="file:///photo-1.png"><img src="file:///photo-10.png">')
  })

  it('leaves a placeholder untouched when no source is resolved for its index', () => {
    expect(replaceClipboardImagePlaceholders('<img src="xmd-copy-image-3">', ['a.png'])).toBe(
      '<img src="xmd-copy-image-3">',
    )
  })
})

describe('svgMarkupToPng', () => {
  it('returns null when the markup has no <svg> root', () => {
    return svgMarkupToPng('<div>not svg</div>', '#fff').then((result) => {
      expect(result).toBeNull()
    })
  })

  it('sizes the canvas from the SVG viewBox and the requested scale', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    const context = stubCanvas()
    let observedWidth = 0
    let observedHeight = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      observedWidth = this.width
      observedHeight = this.height
      return context as unknown as CanvasRenderingContext2D
    })

    const png = await svgMarkupToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>',
      '#f7f7f7',
      2,
    )

    expect(png?.type).toBe('image/png')
    expect(observedWidth).toBe(200)
    expect(observedHeight).toBe(100)
    expect(context.fillStyle).toBe('#f7f7f7')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 100)
    expect(context.drawImage).toHaveBeenCalled()
  })

  it('falls back to width/height attributes when the SVG has no viewBox', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    const context = stubCanvas()
    let observedWidth = 0
    let observedHeight = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      observedWidth = this.width
      observedHeight = this.height
      return context as unknown as CanvasRenderingContext2D
    })

    await svgMarkupToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>',
      '#fff',
      1,
    )

    expect(observedWidth).toBe(300)
    expect(observedHeight).toBe(150)
  })

  it('downscales an oversized diagram to stay under the clipboard pixel budget', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    const context = stubCanvas()
    let observedWidth = 0
    let observedHeight = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      observedWidth = this.width
      observedHeight = this.height
      return context as unknown as CanvasRenderingContext2D
    })

    // 5000x5000 at scale 2 is 100,000,000px — far past MAX_CLIPBOARD_IMAGE_PIXELS
    // (16,000,000), so the fitted canvas must come back smaller than requested.
    await svgMarkupToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000"></svg>',
      '#fff',
      2,
    )

    expect(observedWidth * observedHeight).toBeLessThanOrEqual(16_000_000)
    expect(observedWidth).toBeLessThan(10000)
  })

  it('rejects when the rasterized SVG image fails to decode', async () => {
    imageOutcome = 'error'
    vi.stubGlobal('Image', AutoSettleImage)
    stubCanvas()

    await expect(
      svgMarkupToPng('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', '#fff'),
    ).rejects.toThrow('图表转换失败')
  })

  it('rejects with a timeout error when image decoding never settles', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Image', NeverSettleImage)
    stubCanvas()

    const pending = svgMarkupToPng(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      '#fff',
    )
    const assertion = expect(pending).rejects.toThrow('图表图片解码超时')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })
})

describe('copySvgMarkupAsImage', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'

  it('returns false without attempting any clipboard write when the markup has no <svg>', async () => {
    const clipboardWrite = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { clipboardWrite }, configurable: true })

    expect(await copySvgMarkupAsImage('<div>none</div>', '#fff')).toBe(false)
    expect(desktop.writeClipboardImage).not.toHaveBeenCalled()
  })

  it('writes through the native desktop clipboard when it is available', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    stubCanvas()
    desktop.writeClipboardImage.mockResolvedValueOnce(undefined)
    const clipboardWrite = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWrite },
      configurable: true,
    })

    expect(await copySvgMarkupAsImage(svg, '#fff')).toBe(true)
    expect(desktop.writeClipboardImage).toHaveBeenCalledTimes(1)
    expect(desktop.writeClipboardImage.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    // The native path succeeded, so the Web Clipboard fallback must not run.
    expect(clipboardWrite).not.toHaveBeenCalled()
  })

  it('falls back to the Web Clipboard API when the native adapter rejects', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValueOnce(new Error('no native adapter'))
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWrite },
      configurable: true,
    })
    class RecordingClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', RecordingClipboardItem)

    expect(await copySvgMarkupAsImage(svg, '#fff')).toBe(true)
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    const [item] = clipboardWrite.mock.calls[0][0] as RecordingClipboardItem[]
    expect(Object.keys(item.data)).toEqual(['image/png'])
  })

  it('returns false when both the native adapter and the Web Clipboard are unavailable', async () => {
    vi.stubGlobal('Image', AutoSettleImage)
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValueOnce(new Error('no native adapter'))
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.stubGlobal('ClipboardItem', undefined)

    expect(await copySvgMarkupAsImage(svg, '#fff')).toBe(false)
  })
})

describe('copyImageElement', () => {
  it('returns false immediately when the image has no resolvable source', async () => {
    const image = document.createElement('img')
    expect(await copyImageElement(image)).toBe(false)
    expect(desktop.writeClipboardImage).not.toHaveBeenCalled()
  })

  it('copies an already-rendered image via the native clipboard using its cached canvas render', async () => {
    stubCanvas()
    desktop.writeClipboardImage.mockResolvedValueOnce(undefined)
    const clipboardWrite = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWrite },
      configurable: true,
    })
    const image = makeRenderedImage('https://example.com/copy-image-native.png')

    expect(await copyImageElement(image)).toBe(true)
    expect(desktop.writeClipboardImage).toHaveBeenCalledTimes(1)
    expect(desktop.writeClipboardImage.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(clipboardWrite).not.toHaveBeenCalled()
  })

  it('falls back to the Web Clipboard API when the native adapter rejects', async () => {
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValueOnce(new Error('no native adapter'))
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWrite },
      configurable: true,
    })
    class RecordingClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', RecordingClipboardItem)
    const image = makeRenderedImage('https://example.com/copy-image-fallback.png')

    expect(await copyImageElement(image)).toBe(true)
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
  })

  it('returns false, and never falls back to alt text, when neither clipboard path is available', async () => {
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValueOnce(new Error('no native adapter'))
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.stubGlobal('ClipboardItem', undefined)
    const image = makeRenderedImage('https://example.com/copy-image-unavailable.png')
    image.alt = 'a description'

    expect(await copyImageElement(image)).toBe(false)
  })

  it('returns false when the image cannot be rendered and the network source fails to load', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const image = document.createElement('img')
    image.setAttribute('src', 'https://example.com/unreachable.png')
    // complete=false / naturalWidth=0 (the jsdom/happy-dom default for an
    // <img> that never actually loaded) forces the async fetch fallback.

    expect(await copyImageElement(image)).toBe(false)
    expect(desktop.writeClipboardImage).not.toHaveBeenCalled()
  })
})

describe('setupRichClipboard', () => {
  // Every non-early-return copy path schedules a follow-up write via
  // setTimeout(0) to dodge WebKit committing event.clipboardData only after
  // the copy handler returns. Fake timers keep that write from leaking into
  // later tests as a live real-timer callback when a test doesn't flush it.
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('ignores copy events whose target is outside the managed root', () => {
    const root = mountRoot('<p>inside</p>')
    const outside = document.createElement('div')
    outside.textContent = 'outside'
    document.body.append(outside)
    const dispose = setup(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(outside, clipboardData)

    expect(event.defaultPrevented).toBe(false)
    expect(clipboardData.getData('text/plain')).toBe('')
    dispose()
  })

  it('writes plain text only, and no HTML, when the clipboard format preference is plain', () => {
    setCopyPreferences({ clipboardFormat: 'plain' })
    const root = mountRoot('<p>hello world</p>')
    const dispose = setup(root)
    selectContents(root.querySelector('p') as HTMLParagraphElement)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/plain')).toBe('hello world')
    expect(clipboardData.getData('text/html')).toBe('')
    dispose()
  })

  it('reads plain text from an explicitly selected image via its alt text', () => {
    setCopyPreferences({ clipboardFormat: 'plain' })
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/plain-alt.png')
    image.alt = 'a chart of quarterly revenue'
    markAsSelectedImage(image)
    root.append(image)
    const dispose = setup(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/plain')).toBe('a chart of quarterly revenue')
    dispose()
  })

  it('serializes rich HTML and plain text for a text-only selection', () => {
    const root = mountRoot('<p>hello <strong>world</strong></p>')
    const dispose = setup(root)
    selectContents(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/html')).toContain('<strong>world</strong>')
    expect(clipboardData.getData('text/plain')).toBe('hello world')
    dispose()
  })

  it('reports the effective copy format for the feedback surface', () => {
    const formats: CopyFeedbackFormat[] = []
    const unsubscribe = subscribeCopyFeedback(({ format }) => formats.push(format))
    const root = mountRoot('<p>hello <strong>world</strong></p>')
    const dispose = setup(root)
    selectContents(root)

    dispatchCopy(root, new DataTransfer())
    setCopyPreferences({ clipboardFormat: 'plain' })
    dispatchCopy(root, new DataTransfer())

    expect(formats).toEqual(['rich', 'plain'])
    unsubscribe()
    dispose()
  })

  it('omits color and highlighter tags from rich clipboard HTML by default', () => {
    const root = mountRoot(
      '<p><span class="xmd-cm-inline-color" style="color:red">red</span> and ' +
        '<span class="xmd-cm-inline-highlight" style="background-color:yellow">marked</span></p>',
    )
    const dispose = setup(root)
    selectContents(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/html')).not.toContain('color:red')
    expect(clipboardData.getData('text/html')).not.toContain('background-color:yellow')
    expect(clipboardData.getData('text/html')).toContain('red')
    expect(clipboardData.getData('text/html')).toContain('marked')
    dispose()
  })

  it('keeps color and highlighter formatting when the rich-copy options are enabled', () => {
    setCopyPreferences({ copyTextColor: true, copyHighlightColor: true })
    const root = mountRoot(
      '<p><span class="xmd-cm-inline-color" style="color:red">red</span> and ' +
        '<span class="xmd-cm-inline-highlight" style="background-color:yellow">marked</span></p>',
    )
    const dispose = setup(root)
    selectContents(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/html')).toContain('color:red')
    expect(clipboardData.getData('text/html')).toContain('background-color:yellow')
    dispose()
  })

  it('does not intercept copy when image mode is "address" and the selection holds only an image', () => {
    setCopyPreferences({ imageCopyMode: 'address' })
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/address-mode.png')
    root.append(image)
    selectContents(root)
    const dispose = setup(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    // The handler must step aside so the editor's own "copy as address" logic runs.
    expect(event.defaultPrevented).toBe(false)
    expect(clipboardData.getData('text/html')).toBe('')
    dispose()
  })

  it('still intercepts "address" mode when a Mermaid diagram in the selection must copy as an image', () => {
    setCopyPreferences({ imageCopyMode: 'address', mermaidCopyMode: 'image' })
    mermaidPreview.renderMermaidForExport.mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    )
    vi.stubGlobal('Image', AutoSettleImage)
    stubCanvas()
    const root = mountRoot(
      '<div class="xmd-code-block"><div class="xmd-mermaid-preview"></div>' +
        '<div class="xmd-code-content">flowchart LR\nA --> B</div></div>',
    )
    selectContents(root)
    const dispose = setup(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('writes an image through the native clipboard for a single explicitly selected image', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    stubCanvas()
    desktop.writeClipboardImage.mockResolvedValueOnce(undefined)
    desktop.writeClipboardHtml.mockResolvedValueOnce(undefined)
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/native-single.png')
    markAsSelectedImage(image)
    root.append(image)
    const dispose = setup(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)
    expect(event.defaultPrevented).toBe(true)
    // The cached canvas render resolves synchronously, so the HTML written into
    // the DOM copy event already carries real pixel data, not the placeholder.
    expect(clipboardData.getData('text/html')).toContain('data:image/png;base64,')

    await vi.runAllTimersAsync()

    expect(desktop.writeClipboardImage).toHaveBeenCalledTimes(1)
    expect(desktop.writeClipboardHtml).not.toHaveBeenCalled()
    dispose()
  })

  it('falls back to the Web Clipboard API when the native writer is unavailable', async () => {
    vi.useFakeTimers()
    stubCanvas()
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWrite },
      configurable: true,
    })
    class RecordingClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', RecordingClipboardItem)
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/web-fallback.png')
    markAsSelectedImage(image)
    root.append(image)
    const dispose = setup(root)

    dispatchCopy(root, new DataTransfer())
    await vi.runAllTimersAsync()

    expect(desktop.writeClipboardImage).not.toHaveBeenCalled()
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('falls back to a synchronous execCommand copy when no clipboard API is available', async () => {
    // Some embedded WebViews expose neither the native Tauri adapter nor the
    // async Web Clipboard API. The last resort is the legacy synchronous path,
    // which must run inside the same user gesture as the original copy.
    vi.useFakeTimers()
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValue(new Error('no native adapter'))
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.stubGlobal('ClipboardItem', undefined)
    // A real browser's execCommand('copy') synchronously dispatches its own
    // 'copy' event, which legacyWrite listens for exactly once to hand off
    // the resolved data. Simulate that hand-off instead of only stubbing a
    // return value, so a leaked listener here would surface as a failure
    // instead of silently not being exercised.
    let capturedHtml = ''
    const execCommand = vi.fn((command: string) => {
      if (command === 'copy') {
        const innerData = new DataTransfer()
        document.dispatchEvent(
          new ClipboardEvent('copy', { clipboardData: innerData, cancelable: true }),
        )
        capturedHtml = innerData.getData('text/html')
      }
      return true
    })
    document.execCommand = execCommand
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/legacy-fallback.png')
    markAsSelectedImage(image)
    root.append(image)
    const dispose = setup(root)

    dispatchCopy(root, new DataTransfer())
    await vi.runAllTimersAsync()

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(capturedHtml).toContain('data:image/png;base64,')
    dispose()
  })

  it('leaves no copy listener behind when execCommand reports success without dispatching', async () => {
    // execCommand('copy') is deprecated and is simply a no-op in some WebViews — the very
    // environments this last-resort path exists for. legacyWrite registers its handler with
    // { once: true }, which only self-removes when the event actually fires, so a no-op
    // execCommand would strand it on document where it would preventDefault and inject this
    // copy's stale HTML into the next, unrelated one.
    vi.useFakeTimers()
    stubCanvas()
    desktop.writeClipboardImage.mockRejectedValue(new Error('no native adapter'))
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    vi.stubGlobal('ClipboardItem', undefined)
    document.execCommand = vi.fn(() => true)
    const root = mountRoot('')
    const image = makeRenderedImage('https://example.com/no-dispatch.png')
    markAsSelectedImage(image)
    root.append(image)
    const dispose = setup(root)

    dispatchCopy(root, new DataTransfer())
    await vi.runAllTimersAsync()
    dispose()

    const laterData = new DataTransfer()
    const later = new ClipboardEvent('copy', { clipboardData: laterData, cancelable: true })
    document.dispatchEvent(later)
    expect(laterData.getData('text/html')).toBe('')
    expect(later.defaultPrevented).toBe(false)
  })

  it('stops reacting to copy events once the returned cleanup function runs', () => {
    const root = mountRoot('<p>hello</p>')
    const dispose = setup(root)
    dispose()
    selectContents(root)

    const clipboardData = new DataTransfer()
    const event = dispatchCopy(root, clipboardData)

    expect(event.defaultPrevented).toBe(false)
    expect(clipboardData.getData('text/html')).toBe('')
  })
})
