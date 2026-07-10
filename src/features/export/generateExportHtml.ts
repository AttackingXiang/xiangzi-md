import { desktop } from '../../platform'
import { blobPartFromBytes, imageMimeType, xmdAssetPaths } from '../../lib/asset'
import { mapWithConcurrencyLimit } from '../../lib/asyncPool'
import {
  blobToDataUrl,
  exportOwnedObjectUrlAttribute,
  resizeImageBlob,
} from '../../lib/exportImageAsset'
import { escapeHtmlText, serializeStyleSheets } from '../../lib/exportStyles'
import { getLang } from '../../lib/i18n'
import { imageDimensionsFromBytes, planExportImageMemory } from '../../lib/imageBudget'

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
    // Preserve non-text heading content instead of flattening images/formulas.
    if (heading.querySelector('img, svg, math')) return
    const text = heading.textContent ?? ''
    heading.replaceChildren(
      ...exportHeadingRuns(text).map(({ kind, text: runText }) => {
        const span = document.createElement('span')
        span.className = `xmd-export-heading-run xmd-export-heading-${kind}`
        span.textContent = runText
        return span
      }),
    )
    heading.classList.add('xmd-export-heading')
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

/** Read CommonMark fenced and indented code blocks without assuming exactly three backticks. */
export function markdownCodeBlocks(markdown: string): MarkdownCodeBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownCodeBlock[] = []
  for (let index = 0; index < lines.length; ) {
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[index])
    if (opening) {
      const marker = opening[2][0]
      const length = opening[2].length
      const info = opening[3].trim()
      const code: string[] = []
      index += 1
      const closing = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${length},}\\s*$`)
      while (index < lines.length && !closing.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push({ lang: info.split(/\s+/, 1)[0].toLowerCase(), code: code.join('\n') + '\n' })
      continue
    }

    if (/^(?: {4}|\t)/.test(lines[index])) {
      const code: string[] = []
      while (index < lines.length) {
        const line = lines[index]
        if (/^(?: {4}|\t)/.test(line)) {
          code.push(line.startsWith('\t') ? line.slice(1) : line.slice(4))
          index += 1
        } else if (line === '') {
          code.push('')
          index += 1
        } else break
      }
      while (code.at(-1) === '') code.pop()
      blocks.push({ lang: '', code: code.join('\n') + '\n' })
      continue
    }
    index += 1
  }
  return blocks
}

/** Build a self-contained HTML string that renders identically to the app view */
export async function generateExportHTML(
  title: string,
  mdContent?: string,
  deferImageDecoding = false,
): Promise<string | null> {
  const pm =
    document.querySelector<HTMLElement>('.milkdown .ProseMirror') ??
    document.querySelector<HTMLElement>('.milkdown [contenteditable="true"]') ??
    document.querySelector<HTMLElement>('.milkdown')
  if (!pm) return null

  // ── Reading-view: pre-render all Mermaid diagrams ─────────────────────
  // Parse markdown source to know the language of every code block (including
  // lazy-not-yet-visible ones whose DOM hasn't been initialized yet).
  const mdBlocks = mdContent ? markdownCodeBlocks(mdContent) : []

  const liveBlocks = Array.from(pm.querySelectorAll<HTMLElement>('.milkdown-code-block'))
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const mermaidTheme = isDark ? 'dark' : 'default'

  const { EXPORT_CODE_STYLES, highlightCodeForExport } = await import('../../lib/exportSyntax')

  // Replace editor-only CodeMirror DOM with deterministic reading-view HTML.
  // This also covers lazy/off-screen blocks by falling back to Markdown source.
  const blockRenders = await mapWithConcurrencyLimit(
    liveBlocks,
    EXPORT_WORK_CONCURRENCY,
    async (block, i) => {
      // Already rendered? extract the SVG from the live preview panel.
      const mermaidPreviewEl = block.querySelector<HTMLElement>(
        '.preview-panel .preview .mermaid-preview',
      )
      if (mermaidPreviewEl) {
        const svgEl = mermaidPreviewEl.querySelector('svg') ?? mermaidPreviewEl
        return { kind: 'mermaid' as const, html: svgEl.outerHTML }
      }

      // Determine language: from language-button (initialized block) or from parsed markdown.
      const langBtn = block.querySelector<HTMLElement>('.tools .language-button')
      const langFromBtn = langBtn?.textContent?.trim().toLowerCase() ?? ''
      const lang = langFromBtn || (mdBlocks[i]?.lang ?? '')
      // Get code text: prefer cm-editor lines, fall back to placeholder, then parsed markdown.
      const cmLines = block.querySelectorAll<HTMLElement>('.cm-line')
      const codeFromDOM =
        cmLines.length > 0
          ? Array.from(cmLines)
              .map((l) => l.textContent ?? '')
              .join('\n')
          : (block.querySelector<HTMLElement>('.milkdown-code-block-placeholder code')
              ?.textContent ?? '')
      const code = codeFromDOM.trim().length > 0 ? codeFromDOM : (mdBlocks[i]?.code ?? '')
      if (lang !== 'mermaid') {
        return {
          kind: 'code' as const,
          html: await highlightCodeForExport(code, lang),
          language: lang,
        }
      }
      if (!code.trim()) return { kind: 'code' as const, html: '', language: lang }

      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: mermaidTheme, securityLevel: 'strict' })
        const id = 'mmd-export-' + Math.random().toString(36).slice(2)
        const { svg } = await mermaid.render(id, code)
        return { kind: 'mermaid' as const, html: svg }
      } catch {
        return {
          kind: 'code' as const,
          html: await highlightCodeForExport(code, lang),
          language: lang,
        }
      }
    },
  )

  // ── Clone and clean ───────────────────────────────────────────────────
  const clone = pm.cloneNode(true) as HTMLElement

  // Strip Milkdown UI decorations AND code-block toolbar (.tools).
  const MILKDOWN_UI = [
    '.milkdown-toolbar',
    '.milkdown-block-handle',
    '.milkdown-slash-menu',
    '.milkdown-top-bar',
    '.milkdown-ai-diff-actions',
    '.milkdown-ai-instruction',
    '.milkdown-ai-streaming',
    '.milkdown-latex-inline-edit',
    '.milkdown-link-edit',
    '.milkdown-link-preview',
    '.milkdown-diff-controls',
    '.milkdown-diff-controls-block',
    '.handle',
    '.drag-preview',
    '.tools', // code block top-bar: language picker + copy / toggle buttons
    '.fold-btn', // heading fold toggle injected by headingFoldPlugin
  ].join(', ')
  clone.querySelectorAll(MILKDOWN_UI).forEach((el) => el.remove())
  // Export the complete document regardless of the editor's transient fold state.
  clone
    .querySelectorAll('.heading-fold-hidden')
    .forEach((el) => el.classList.remove('heading-fold-hidden'))
  // An unfinished image is an editor control, not document content.
  clone.querySelectorAll('.milkdown-image-inline').forEach((node) => {
    if (node.querySelector('.empty-image-inline')) node.remove()
  })
  clone.querySelectorAll('.milkdown-image-block').forEach((node) => {
    if (node.querySelector(':scope > .image-edit')) node.remove()
  })
  clone.querySelectorAll('.selectedCell, .ProseMirror-selectednode').forEach((el) => {
    el.classList.remove('selectedCell', 'ProseMirror-selectednode')
  })
  clone.removeAttribute('contenteditable')
  clone.querySelectorAll('[contenteditable]').forEach((el) => {
    el.removeAttribute('contenteditable')
  })
  clone.querySelectorAll('[spellcheck]').forEach((el) => {
    el.removeAttribute('spellcheck')
  })
  // html2canvas/WebKit can calculate different baselines for Latin and CJK
  // glyph runs inside the same heading. Materialize those runs as flex
  // items so their visual alignment is deterministic in image exports.
  normalizeExportHeadings(clone)

  // Reading-view code block processing.
  const cloneBlocks = Array.from(clone.querySelectorAll<HTMLElement>('.milkdown-code-block'))
  cloneBlocks.forEach((block, i) => {
    const render = blockRenders[i]
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
  const liveImgs = Array.from(pm.querySelectorAll<HTMLImageElement>('img[src]'))
  const localImages = (
    await mapWithConcurrencyLimit(
      imgs,
      EXPORT_WORK_CONCURRENCY,
      async (image, index): Promise<LocalExportImage | null> => {
        const source = image.getAttribute('src') ?? ''
        const paths = xmdAssetPaths(source)
        if (paths.length === 0) return null

        let failure: unknown
        for (const path of paths) {
          try {
            const bytes = await desktop.readBinaryFile(path, MAX_SINGLE_EXPORT_IMAGE_BYTES)
            const blob = new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(path) })
            const parsed = imageDimensionsFromBytes(bytes)
            const liveImage =
              liveImgs[index]?.getAttribute('src') === source
                ? liveImgs[index]
                : liveImgs.find((candidate) => candidate.getAttribute('src') === source)
            const width = liveImage?.naturalWidth || parsed?.width || null
            const height = liveImage?.naturalHeight || parsed?.height || null
            const renderedWidth = liveImage?.getBoundingClientRect().width ?? 0
            return {
              image,
              blob,
              width,
              height,
              displayWidth: Math.min(
                EXPORT_CONTENT_WIDTH,
                Math.max(1, renderedWidth || width || EXPORT_CONTENT_WIDTH),
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
    const plan = planExportImageMemory(
      plannable.map((image) => ({
        width: image.width,
        height: image.height,
        displayWidth: image.displayWidth,
      })),
      {
        documentHeight: Math.max(pm.scrollHeight, pm.getBoundingClientRect().height),
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
        const objectUrl = URL.createObjectURL(output)
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
</style>
<style>
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}
html,body{margin:0;padding:0;height:auto;overflow:visible;background:var(--bg,#fff)}
.export-view{flex:none;overflow:visible}
.milkdown{padding:0;background:var(--bg,#fff)}
.ProseMirror.export-content{max-width:800px;margin:0 auto;padding:48px 40px 80px;outline:none}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6){font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif!important}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) *{font-family:inherit!important;line-height:inherit}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) strong{font-weight:inherit}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading{display:flex!important;align-items:center!important;flex-wrap:wrap}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading::before{align-self:center;flex:none}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading-run{display:inline-block;flex:none;line-height:1!important;font-weight:inherit!important;white-space:pre}
.wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading-latin{transform:translateY(-0.28em)}
html[data-heading-number='on'] .export-view .milkdown :is(h1,h2,h3,h4,h5,h6)::before{color:inherit;font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit}
.mermaid-export svg{max-width:100%;height:auto}
${EXPORT_CODE_STYLES}
</style>
</head><body>
<div class="wysiwyg-editor export-view"><div class="milkdown"><div class="ProseMirror export-content">${clone.innerHTML}</div></div></div>
</body></html>`
}
