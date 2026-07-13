import { desktop } from '../../platform'
import { blobPartFromBytes, imageMimeType, resolveAssetURL, xmdAssetPaths } from '../../lib/asset'
import { mapWithConcurrencyLimit } from '../../lib/asyncPool'
import {
  blobToDataUrl,
  exportOwnedObjectUrlAttribute,
  resizeImageBlob,
  withOwnedExportObjectUrls,
} from '../../lib/exportImageAsset'
import { escapeHtmlText, serializeStyleSheets } from '../../lib/exportStyles'
import { getLang } from '../../lib/i18n'
import {
  EXPORT_RASTER_WIDTH,
  fitImageDimensions,
  imageDimensionsFromBytes,
  MAX_EXPORT_DOCUMENT_PIXELS,
  planExportImageMemory,
} from '../../lib/imageBudget'
import { renderMermaidForExport } from '../../lib/mermaidPreview'
import { markdownHeadingSlug } from '../../lib/linkNavigation'
import MarkdownIt from 'markdown-it'

interface LocalExportImage {
  image: HTMLImageElement
  blob: Blob
  width: number | null
  height: number | null
  displayWidth: number
}

type HeadingRunKind = 'cjk' | 'latin' | 'space' | 'neutral'

function exportHeadingRuns(text: string): Array<{ kind: HeadingRunKind; text: string }> {
  const runs: Array<{ kind: HeadingRunKind; text: string }> = []
  for (const character of text) {
    let kind: HeadingRunKind
    if (/\s/u.test(character)) kind = 'space'
    else if (/\p{Script=Han}/u.test(character)) kind = 'cjk'
    else if (/[A-Za-z0-9]/u.test(character)) kind = 'latin'
    else kind = runs.at(-1)?.kind ?? 'neutral'

    const previous = runs.at(-1)
    if (previous?.kind === kind) previous.text += character
    else runs.push({ kind, text: character })
  }
  return runs
}

function normalizeExportHeadings(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const textNodes: Text[] = []
    const walker = heading.ownerDocument.createTreeWalker(heading, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue
      const parent = node.parentElement
      // KaTeX relies on its own deeply nested spans and text nodes. It is
      // already baseline-normalized and must not be rewritten.
      if (parent?.closest('.katex')) continue
      textNodes.push(node)
    }
    for (const textNode of textNodes) {
      const runs = exportHeadingRuns(textNode.data)
      if (runs.length === 0) continue
      textNode.replaceWith(
        ...runs.map(({ kind, text: runText }) => {
          const span = document.createElement('span')
          span.className = `xmd-export-heading-run xmd-export-heading-${kind}`
          span.textContent = runText
          return span
        }),
      )
    }
    heading.classList.add('xmd-export-heading')
  })
}

export function exportHeadingIds(headings: readonly string[]): string[] {
  const occurrences = new Map<string, number>()
  return headings.map((heading) => {
    const base = markdownHeadingSlug(heading)
    if (!base) return ''
    const seen = occurrences.get(base) ?? 0
    occurrences.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
  })
}

function assignExportHeadingIds(root: HTMLElement): void {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  const ids = exportHeadingIds(headings.map((heading) => heading.textContent ?? ''))
  headings.forEach((heading, index) => {
    const id = ids[index]
    if (id) heading.id = id
  })
}

const EXPORT_WORK_CONCURRENCY = 2
const EXPORT_RESIZE_CONCURRENCY = 1
const MAX_SINGLE_EXPORT_IMAGE_BYTES = 64 * 1024 * 1024
const EXPORT_CONTENT_WIDTH = 800

export interface MarkdownCodeBlock {
  lang: string
  code: string
}

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
})

/** Read exactly the code blocks recognized by the renderer, including nested blocks. */
export function markdownCodeBlocks(markdown: string): MarkdownCodeBlock[] {
  return markdownRenderer
    .parse(markdown, {})
    .filter((token) => token.type === 'fence' || token.type === 'code_block')
    .map((token) => ({
      lang: token.type === 'fence' ? token.info.trim().split(/\s+/, 1)[0].toLowerCase() : '',
      code: token.content,
    }))
}

/** Deterministic full-source render; it never reads editor or viewport DOM. */
export function renderMarkdownSource(markdown: string): string {
  return markdownRenderer
    .render(markdown)
    .replace(
      /<li>\[([ xX])\]\s*/g,
      (_match, checked: string) =>
        `<li class="task-list-item"><input type="checkbox" disabled${checked === ' ' ? '' : ' checked'}> `,
    )
    .replace(/<ul>\s*(?=<li class="task-list-item">)/g, '<ul class="task-list">\n')
}

export interface ExportMathExpression {
  from: number
  to: number
  source: string
  displayMode: boolean
}

function isEscaped(text: string, offset: number): boolean {
  let slashes = 0
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}

/** Match the same conservative dollar-math boundaries as the CM6 preview. */
export function exportMathExpressions(text: string): ExportMathExpression[] {
  const result: ExportMathExpression[] = []
  let index = 0
  while (index < text.length) {
    if (text[index] !== '$' || isEscaped(text, index)) {
      index += 1
      continue
    }
    const displayMode = text[index + 1] === '$'
    const markerLength = displayMode ? 2 : 1
    const contentStart = index + markerLength
    if (contentStart >= text.length || (!displayMode && /\s/.test(text[contentStart] ?? ''))) {
      index += markerLength
      continue
    }
    let close = contentStart
    while (close < text.length) {
      if (!displayMode && text[close] === '\n') break
      const matches = displayMode
        ? text[close] === '$' && text[close + 1] === '$'
        : text[close] === '$'
      if (matches && !isEscaped(text, close)) break
      close += 1
    }
    const hasClose =
      close < text.length &&
      (displayMode ? text[close] === '$' && text[close + 1] === '$' : text[close] === '$')
    const source = text.slice(contentStart, close)
    const next = text[close + markerLength] ?? ''
    const valid =
      hasClose &&
      source.length > 0 &&
      (displayMode
        ? source.trim().length > 0
        : !/\s/.test(text[close - 1] ?? '') && !/\d/.test(next))
    if (!valid) {
      index += markerLength
      continue
    }
    result.push({
      from: index,
      to: close + markerLength,
      source: displayMode ? source.trim() : source,
      displayMode,
    })
    index = close + markerLength
  }
  return result
}

type CssAssetLoader = (absoluteUrl: string) => Promise<string>

export function preferWoff2FontSources(css: string): string {
  return css.replace(/src:([^;}]+)/g, (original, sources: string) => {
    const preferred = sources
      .split(',')
      .find((candidate) => /format\(\s*['"]?woff2['"]?\s*\)/i.test(candidate))
    return preferred ? `src:${preferred.trim()}` : original
  })
}

export async function inlineExportCssAssets(
  css: string,
  baseUrl: string,
  load: CssAssetLoader = async (absoluteUrl) => {
    const response = await fetch(absoluteUrl)
    if (!response.ok) throw new Error(`无法读取公式字体：${response.status}`)
    return blobToDataUrl(await response.blob())
  },
): Promise<string> {
  const sources = [
    ...new Set(Array.from(css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g), (match) => match[2])),
  ].filter((source) => !/^(?:data:|blob:|#)/i.test(source))
  const base = new URL(baseUrl)
  const replacements = new Map<string, string>()
  await mapWithConcurrencyLimit(sources, EXPORT_WORK_CONCURRENCY, async (source) => {
    try {
      const absolute = new URL(source, base)
      // The stylesheet is bundled with the app. Never turn an unexpected
      // third-party CSS URL into an implicit network request during export.
      if (absolute.origin !== base.origin) return
      replacements.set(source, await load(absolute.href))
    } catch {
      // Keep the original URL as a graceful fallback when a bundled font is
      // unavailable; formula text remains readable instead of aborting export.
    }
  })
  return css.replace(
    /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
    (original, _quote: string, source: string) =>
      replacements.has(source) ? `url("${replacements.get(source)}")` : original,
  )
}

async function renderExportMath(root: HTMLElement): Promise<string> {
  const textNodes: Text[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue
    if (node.parentElement?.closest('pre, code, kbd, samp, .katex')) continue
    if (node.data.includes('$')) textNodes.push(node)
  }
  if (textNodes.length === 0) return ''

  const targets = textNodes
    .map((textNode) => ({ textNode, expressions: exportMathExpressions(textNode.data) }))
    .filter(({ expressions }) => expressions.length > 0)
  if (targets.length === 0) return ''

  const [{ default: katex }, { default: katexCss }] = await Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css?inline'),
  ])
  for (const { textNode, expressions } of targets) {
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const expression of expressions) {
      fragment.append(textNode.data.slice(offset, expression.from))
      const element = document.createElement('span')
      element.className = expression.displayMode
        ? 'xmd-export-math xmd-export-math-display'
        : 'xmd-export-math xmd-export-math-inline'
      try {
        element.innerHTML = katex.renderToString(expression.source, {
          displayMode: expression.displayMode,
          throwOnError: true,
        })
        fragment.append(element)
      } catch {
        fragment.append(textNode.data.slice(expression.from, expression.to))
      }
      offset = expression.to
    }
    fragment.append(textNode.data.slice(offset))
    textNode.replaceWith(fragment)
  }
  return inlineExportCssAssets(preferWoff2FontSources(katexCss), document.baseURI)
}

/**
 * Table editing stores an intentional soft line break as the canonical
 * `<br>`. Raw HTML remains disabled globally; only that exact table-cell
 * representation is materialized, and code spans stay literal.
 */
function restoreTableCellLineBreaks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('th, td').forEach((cell) => {
    const textNodes: Text[] = []
    const walker = cell.ownerDocument.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue
      if (node.parentElement?.closest('code, pre')) continue
      if (/<br\s*\/?>/i.test(node.data)) textNodes.push(node)
    }
    for (const textNode of textNodes) {
      const parts = textNode.data.split(/(<br\s*\/?>)/gi)
      textNode.replaceWith(
        ...parts.map((part) =>
          /^<br\s*\/?>$/i.test(part) ? document.createElement('br') : document.createTextNode(part),
        ),
      )
    }
  })
}

/** Conservative layout estimate used before the isolated renderer is mounted. */
export function estimateExportDocumentHeight(markdown: string): number {
  const rows = markdown.replace(/\r\n?/g, '\n').split('\n')
  const visualRows = rows.reduce((total, row) => {
    const characters = Array.from(row).length
    return total + Math.max(1, Math.ceil(characters / 48))
  }, 0)
  return 128 + visualRows * 28
}

export interface MarkdownExportOptions {
  /** Required to resolve and inline relative local images from raw Markdown. */
  docDir?: string | null
  /** PDF renders one page at a time; only a long image export owns a full-page RGBA buffer. */
  target?: 'html' | 'pdf' | 'image'
}

/** Build a self-contained HTML document from the complete Markdown source. */
export async function generateExportHTML(
  title: string,
  mdContent = '',
  deferImageDecoding = false,
  options: MarkdownExportOptions = {},
): Promise<string | null> {
  return withOwnedExportObjectUrls(async (createObjectUrl) => {
    const mdBlocks = markdownCodeBlocks(mdContent)
    const { EXPORT_CODE_STYLES, highlightCodeForExport } = await import('../../lib/exportSyntax')
    const blockRenders = await mapWithConcurrencyLimit(
      mdBlocks,
      EXPORT_WORK_CONCURRENCY,
      async ({ lang, code }) => {
        if (lang !== 'mermaid') {
          return {
            kind: 'code' as const,
            html: await highlightCodeForExport(code, lang),
            language: lang,
          }
        }
        if (!code.trim()) return { kind: 'code' as const, html: '', language: lang }

        try {
          return { kind: 'mermaid' as const, html: await renderMermaidForExport(code) }
        } catch {
          return {
            kind: 'code' as const,
            html: await highlightCodeForExport(code, lang),
            language: lang,
          }
        }
      },
    )

    const clone = document.createElement('div')
    clone.innerHTML = renderMarkdownSource(mdContent)
    clone.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
      const source = image.getAttribute('src') ?? ''
      image.setAttribute('src', resolveAssetURL(options.docDir ?? null, source, null, [], true))
    })
    assignExportHeadingIds(clone)
    restoreTableCellLineBreaks(clone)
    const exportMathStyles = await renderExportMath(clone)
    normalizeExportHeadings(clone)
    const cloneBlocks = Array.from(clone.querySelectorAll<HTMLElement>('pre'))
    cloneBlocks.forEach((block, index) => {
      const render = blockRenders[index]
      if (render?.kind === 'mermaid') {
        // Replace the entire code block with the static SVG.
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-export'
        wrapper.style.cssText = 'margin:16px 0;overflow:auto;text-align:center'
        wrapper.innerHTML = render.html
        block.replaceWith(wrapper)
      } else {
        const pre = document.createElement('pre')
        pre.className = 'xmd-export-code'
        const code = document.createElement('code')
        if (render?.language) code.dataset.language = render.language
        code.innerHTML = render?.html ?? ''
        pre.appendChild(code)
        block.replaceWith(pre)
      }
    })

    // Inline local images without a compressed-total hard limit. For PDF/image
    // exports, plan from decoded pixels and resize only the temporary copy.
    const imgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img[src]'))
    const localImages = (
      await mapWithConcurrencyLimit(
        imgs,
        EXPORT_WORK_CONCURRENCY,
        async (image): Promise<LocalExportImage | null> => {
          const source = image.getAttribute('src') ?? ''
          const paths = xmdAssetPaths(source)
          if (paths.length === 0) return null

          let failure: unknown
          for (const path of paths) {
            try {
              const bytes = await desktop.readBinaryFile(path, MAX_SINGLE_EXPORT_IMAGE_BYTES)
              const blob = new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(path) })
              const parsed = imageDimensionsFromBytes(bytes)
              const width = parsed?.width || null
              const height = parsed?.height || null
              return {
                image,
                blob,
                width,
                height,
                displayWidth: Math.min(
                  EXPORT_CONTENT_WIDTH,
                  Math.max(1, width || EXPORT_CONTENT_WIDTH),
                ),
              }
            } catch (error) {
              failure = error
            }
          }
          throw failure instanceof Error ? failure : new Error(`无法读取导出图片：${paths[0]}`)
        },
      )
    ).filter((image): image is LocalExportImage => image !== null)

    const plannedDimensions = new Map<HTMLImageElement, { width: number; height: number }>()
    if (deferImageDecoding) {
      const plannable = localImages.filter(
        (image): image is LocalExportImage & { width: number; height: number } =>
          image.width !== null && image.height !== null,
      )
      const documentRaster =
        options.target === 'image'
          ? fitImageDimensions(
              EXPORT_RASTER_WIDTH,
              estimateExportDocumentHeight(mdContent),
              MAX_EXPORT_DOCUMENT_PIXELS,
            )
          : { width: EXPORT_RASTER_WIDTH, height: 4_000 }
      const plan = planExportImageMemory(
        plannable.map((image) => ({
          width: image.width,
          height: image.height,
          displayWidth: image.displayWidth,
        })),
        {
          documentHeight: documentRaster.height,
          exportWidth: documentRaster.width,
        },
      )
      plan.images.forEach((dimensions, index) => {
        plannedDimensions.set(plannable[index].image, dimensions)
      })

      if (plan.overBudget) {
        const estimatedMb = Math.ceil(plan.estimatedPeakBytes / (1024 * 1024))
        const proceed = await desktop.confirm(
          getLang() === 'en'
            ? `This image-heavy export may use about ${estimatedMb} MB of memory. Images will be optimized to their visible export size. Continue?`
            : `此多图文档预计导出峰值约 ${estimatedMb} MB。图片会按导出可见尺寸自动优化，是否继续？`,
          getLang() === 'en' ? 'Large export' : '大型导出任务',
          getLang() === 'en' ? 'Continue' : '继续导出',
          getLang() === 'en' ? 'Cancel' : '取消',
        )
        if (!proceed) return null
      }
    }

    await mapWithConcurrencyLimit(
      localImages,
      deferImageDecoding ? EXPORT_RESIZE_CONCURRENCY : EXPORT_WORK_CONCURRENCY,
      async (localImage) => {
        const target = plannedDimensions.get(localImage.image)
        let output = localImage.blob
        if (
          target &&
          localImage.width !== null &&
          localImage.height !== null &&
          (target.width < localImage.width || target.height < localImage.height)
        ) {
          output = await resizeImageBlob(
            localImage.blob,
            { width: localImage.width, height: localImage.height },
            target,
          )
        }
        if (deferImageDecoding) {
          const objectUrl = createObjectUrl(output)
          localImage.image.setAttribute('src', objectUrl)
          localImage.image.setAttribute(exportOwnedObjectUrlAttribute(), objectUrl)
        } else {
          localImage.image.setAttribute('src', await blobToDataUrl(output))
        }
      },
    )

    // Keep every source in the export document, but defer decoding so the
    // isolated renderer can load images one at a time.
    if (deferImageDecoding) {
      imgs.forEach((img) => {
        const source = img.getAttribute('src')
        if (!source) return
        // Export frames are positioned far off-screen. WebKit will not load
        // lazy images there, so make deferred export images explicitly eager.
        img.setAttribute('loading', 'eager')
        img.setAttribute('decoding', 'sync')
        img.setAttribute('data-xmd-export-src', source)
        img.removeAttribute('src')
      })
    }

    // Production CSS is emitted as <link rel="stylesheet"> by Vite, while
    // custom themes and some editor features use <style>. Reading cssRules
    // captures both forms; selecting only <style> drops Crepe's list/code CSS.
    const liveStyles = serializeStyleSheets(Array.from(document.styleSheets))
    const theme = document.documentElement.getAttribute('data-theme') ?? ''
    const headingNumber = document.documentElement.getAttribute('data-heading-number') ?? ''
    const htmlAttrs = [
      'lang="zh-CN"',
      theme ? `data-theme="${escapeHtmlText(theme)}"` : '',
      headingNumber ? `data-heading-number="${escapeHtmlText(headingNumber)}"` : '',
    ]
      .filter(Boolean)
      .join(' ')

    return `<!doctype html>
<html ${htmlAttrs}><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtmlText(title)}</title>
<style id="xmd-export-runtime-styles">
${liveStyles}
${exportMathStyles}
</style>
<style>
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}
html,body{margin:0;padding:0;height:auto;overflow:visible;background:var(--bg,#fff)}
.export-view{flex:none;overflow:visible}
.milkdown{padding:0;background:var(--bg,#fff)}
.ProseMirror.export-content{max-width:800px;margin:0 auto;padding:48px 40px 80px;outline:none}
.export-content{color:var(--text,#202124);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;font-size:16px;line-height:1.72}
.export-content :is(h1,h2,h3,h4,h5,h6){margin:1.1em 0 .45em;padding-block:.18em;line-height:1.28;text-decoration:none}
.export-content h1{font-size:2em}.export-content h2{font-size:1.62em}.export-content h3{font-size:1.32em}.export-content h4{font-size:1.14em}.export-content h5{font-size:1em}.export-content h6{font-size:.92em}
.export-content p{margin:.75em 0}.export-content ul,.export-content ol{padding-left:1.75em}.export-content li{margin:.25em 0}
.export-content blockquote{margin:1em 0;padding:.15em 1em;border-left:4px solid var(--accent,#7c6cff);color:var(--text-2,#555)}
.export-content hr{height:0;margin:.28em 0;border:0;border-top:1px solid var(--border-strong,#c7c9cc)}
.export-content :not(pre)>code{padding:.15em .36em;border-radius:5px;background:var(--code-inline-bg,#f2f3f5)}
.export-content{overflow-wrap:anywhere}.export-content table{width:100%;max-width:100%;border-collapse:collapse;margin:1em 0;table-layout:auto}.export-content th,.export-content td{min-width:0;padding:8px 12px;border:1px solid var(--border,#dfe1e5);text-align:left;overflow-wrap:anywhere}.export-content th{background:var(--bg-hover,#f7f7f8)}
.export-content img{display:block;max-width:100%;height:auto;margin:1em auto}.export-content .task-list{list-style:none;padding-left:.5em}.export-content .task-list-item input{margin-right:.5em}
.export-content pre,.export-content pre code{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.xmd-export-math-display{display:block;overflow-x:auto;text-align:center}.xmd-export-math-inline{display:inline}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6){font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif!important}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) *{font-family:inherit!important;line-height:inherit}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) strong{font-weight:inherit}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading{display:flex!important;align-items:baseline!important;flex-wrap:wrap}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading::before{align-self:baseline;flex:none}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading-run{display:inline-block;flex:none;line-height:1!important;font-weight:inherit!important;white-space:pre}
html[data-heading-number='on'] .export-view .milkdown :is(h1,h2,h3,h4,h5,h6)::before{color:inherit;font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit}
.mermaid-export svg{max-width:100%;height:auto}
${EXPORT_CODE_STYLES}
.export-view .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6){text-decoration:none!important}.export-view .ProseMirror.export-content h1{font-size:2em!important}.export-view .ProseMirror.export-content h2{font-size:1.62em!important}.export-view .ProseMirror.export-content h3{font-size:1.32em!important}.export-view .ProseMirror.export-content h4{font-size:1.14em!important}.export-view .ProseMirror.export-content h5{font-size:1em!important}.export-view .ProseMirror.export-content h6{font-size:.92em!important}
/* Mermaid writes its intrinsic width as an inline max-width. Do not override it with !important: a 108px diagram would otherwise be stretched to the full 720px content width. */
.export-view .ProseMirror.export-content table{width:100%!important;max-width:100%!important;table-layout:auto!important}.export-view .ProseMirror.export-content :is(th,td){min-width:0!important;overflow-wrap:anywhere!important}.export-view .ProseMirror.export-content pre.xmd-export-code{position:relative}.export-view .ProseMirror.export-content pre.xmd-export-code:has(code[data-language]){padding-top:34px}.export-view .ProseMirror.export-content pre.xmd-export-code code[data-language]::before{content:attr(data-language);position:absolute;top:9px;right:14px;color:var(--text-muted,#8b8f98);font:12px/1.4 ui-monospace,monospace}.export-view .ProseMirror.export-content pre.xmd-export-code,.export-view .ProseMirror.export-content pre.xmd-export-code code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important}.export-view .ProseMirror.export-content hr{height:0!important;margin:.28em 0!important;border:0!important;border-top:1px solid var(--border-strong,#c7c9cc)!important}.export-view .ProseMirror.export-content .mermaid-export svg{display:block;height:auto!important;margin:auto}
</style>
</head><body>
<div class="wysiwyg-editor export-view"><div class="milkdown"><div class="ProseMirror export-content">${clone.innerHTML}</div></div></div>
</body></html>`
  })
}
