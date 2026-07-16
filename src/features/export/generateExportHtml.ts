import { desktop } from '../../platform'
import { blobPartFromBytes, imageMimeType, xmdAssetPaths } from '../../lib/asset'
import { mapWithConcurrencyLimit } from '../../lib/asyncPool'
import { escapeHtmlText, serializeStyleSheets } from '../../lib/exportStyles'
import { markdownHeadingSlug } from '../../lib/linkNavigation'
import { createFullEditorDom } from './editorDomExport'

const EXPORT_WORK_CONCURRENCY = 2
const MAX_SINGLE_EXPORT_ASSET_BYTES = 64 * 1024 * 1024

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('导出资源转换结果无效')),
      { once: true },
    )
    reader.addEventListener('error', () => reject(reader.error ?? new Error('导出资源转换失败')), {
      once: true,
    })
    reader.readAsDataURL(blob)
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

function assignHeadingIds(root: HTMLElement): void {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('.cm-line.xmd-cm-heading'))
  const ids = exportHeadingIds(headings.map((heading) => heading.textContent ?? ''))
  headings.forEach((heading, index) => {
    if (ids[index]) heading.id = ids[index]
  })
}

function materializeLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.xmd-cm-link[data-xmd-href]').forEach((element) => {
    const href = element.dataset.xmdHref ?? ''
    if (!/^(?:https?:|mailto:|#)/i.test(href)) return
    const anchor = document.createElement('a')
    for (const attribute of Array.from(element.attributes)) {
      if (!['role', 'tabindex', 'data-xmd-editing'].includes(attribute.name)) {
        anchor.setAttribute(attribute.name, attribute.value)
      }
    }
    anchor.href = href
    anchor.replaceChildren(...Array.from(element.childNodes))
    element.replaceWith(anchor)
  })
}

function removeInteractiveChrome(root: HTMLElement): void {
  root
    .querySelectorAll(
      [
        '.cm-announced',
        '.cm-selectionLayer',
        '.cm-cursorLayer',
        '.cm-tooltip',
        '.cm-panels',
        '.xmd-cm-code-preview-header',
        '.xmd-cm-code-scrollbar',
        '.xmd-cm-preview-copy',
        '.xmd-cm-mermaid-actions',
        '.xmd-cm-math-actions',
        '.xmd-cm-table-menu',
      ].join(','),
    )
    .forEach((element) => element.remove())
  root.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
    element.contentEditable = 'false'
  })
  root.querySelectorAll<HTMLInputElement>('input').forEach((element) => {
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.toggleAttribute('checked', element.checked)
    } else {
      element.setAttribute('value', element.value)
    }
    element.readOnly = true
    element.removeAttribute('tabindex')
  })
  root.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((element) => {
    element.textContent = element.value
    element.readOnly = true
    element.removeAttribute('tabindex')
  })
  root.querySelectorAll<HTMLSelectElement>('select').forEach((element) => {
    Array.from(element.options).forEach((option) => {
      option.toggleAttribute('selected', option.selected)
    })
    element.removeAttribute('tabindex')
  })
  root
    .querySelectorAll<HTMLElement>('[tabindex]')
    .forEach((element) => element.removeAttribute('tabindex'))
}

async function inlineLocalImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'))
  await mapWithConcurrencyLimit(images, EXPORT_WORK_CONCURRENCY, async (image) => {
    const source = image.getAttribute('src') ?? ''
    const paths = xmdAssetPaths(source)
    if (paths.length === 0) return

    let failure: unknown
    for (const path of paths) {
      try {
        const bytes = await desktop.readBinaryFile(path, MAX_SINGLE_EXPORT_ASSET_BYTES)
        image.src = await blobToDataUrl(
          new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(path) }),
        )
        return
      } catch (error) {
        failure = error
      }
    }
    throw failure instanceof Error ? failure : new Error(`无法读取导出图片：${paths[0]}`)
  })
}

type CssAssetLoader = (absoluteUrl: string) => Promise<string>

export function exportCssAssetMimeType(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0].toLowerCase()
  if (cleanPath.endsWith('.woff2')) return 'font/woff2'
  if (cleanPath.endsWith('.woff')) return 'font/woff'
  if (cleanPath.endsWith('.ttf')) return 'font/ttf'
  if (cleanPath.endsWith('.otf')) return 'font/otf'
  if (cleanPath.endsWith('.css')) return 'text/css'
  return imageMimeType(cleanPath)
}

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
    const paths = xmdAssetPaths(absoluteUrl)
    if (paths.length > 0) {
      const bytes = await desktop.readBinaryFile(paths[0], MAX_SINGLE_EXPORT_ASSET_BYTES)
      return blobToDataUrl(
        new Blob([blobPartFromBytes(bytes)], { type: exportCssAssetMimeType(paths[0]) }),
      )
    }
    const response = await fetch(absoluteUrl)
    if (!response.ok) throw new Error(`无法读取导出样式资源：${response.status}`)
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
      if (absolute.origin !== base.origin && xmdAssetPaths(absolute.href).length === 0) return
      replacements.set(source, await load(absolute.href))
    } catch {
      // Optional fonts/backgrounds keep their original URL as a graceful fallback.
    }
  })

  return css.replace(
    /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
    (original, _quote: string, source: string) =>
      replacements.has(source) ? `url("${replacements.get(source)}")` : original,
  )
}

/** Serialize the complete DOM produced by the same CM6 renderer used on screen. */
export async function generateExportHTML(title: string): Promise<string> {
  const root = await createFullEditorDom()
  removeInteractiveChrome(root)
  materializeLinks(root)
  assignHeadingIds(root)
  await inlineLocalImages(root)

  const liveStyles = serializeStyleSheets(Array.from(document.styleSheets))
  const styles = await inlineExportCssAssets(preferWoff2FontSources(liveStyles), document.baseURI)
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
<style>${styles}</style>
<style>
html,body{margin:0;min-height:100%;background:var(--bg,#fff)}
.xmd-export-renderer{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:100vh;overflow:visible!important;contain:none!important}
.xmd-export-renderer .xmd-cm-mount,.xmd-export-renderer .cm-editor,.xmd-export-renderer .cm-scroller{height:auto!important;overflow:visible!important}
.xmd-export-renderer .cm-content{min-height:0!important}
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}
</style></head><body class="${escapeHtmlText(document.body.className)}">${root.outerHTML}</body></html>`
}
