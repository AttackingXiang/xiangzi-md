const XMD_CLIPBOARD_KIND = 'markdown'
const XMD_CLIPBOARD_KIND_ATTRIBUTE = 'data-xmd-clipboard'
const XMD_MARKDOWN_SOURCE_ATTRIBUTE = 'data-xmd-markdown-source'

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
])

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Carry the exact Markdown beside portable HTML without changing what other apps render. */
export function embedMarkdownSourceInClipboardHtml(html: string, markdown: string): string {
  return `<div ${XMD_CLIPBOARD_KIND_ATTRIBUTE}="${XMD_CLIPBOARD_KIND}" ${XMD_MARKDOWN_SOURCE_ATTRIBUTE}="${encodeBase64Utf8(markdown)}">${html}</div>`
}

function embeddedMarkdownSource(document: Document): string | null {
  const marker = document.body.querySelector<HTMLElement>(
    `[${XMD_CLIPBOARD_KIND_ATTRIBUTE}="${XMD_CLIPBOARD_KIND}"][${XMD_MARKDOWN_SOURCE_ATTRIBUTE}]`,
  )
  const encoded = marker?.getAttribute(XMD_MARKDOWN_SOURCE_ATTRIBUTE)
  return encoded === null || encoded === undefined ? null : decodeBase64Utf8(encoded)
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([\\`*_[\]])/g, '\\$1')
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, '<br>')
}

function destination(value: string, image = false): string | null {
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  const allowed = image
    ? ['data', 'file', 'http', 'https', 'xmd']
    : ['file', 'http', 'https', 'mailto', 'xmd']
  if (scheme && !allowed.includes(scheme)) return null
  if (scheme === 'data' && !/^data:image\//i.test(href)) return null
  return href.replace(/([()\\])/g, '\\$1')
}

function inlineCode(value: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(1, longest + 1))
  const padding = /^\s|\s$/.test(value) ? ' ' : ''
  return `${fence}${padding}${value}${padding}${fence}`
}

function cssColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(trimmed)
  if (shortHex)
    return `#${shortHex
      .slice(1)
      .map((part) => part + part)
      .join('')}`
  if (/^#[\da-f]{6}$/i.test(trimmed)) return trimmed
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed)
  if (!rgb) return null
  const channels = rgb.slice(1, 4).map((part) => Math.min(255, Number(part)))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function styleValue(element: HTMLElement, property: string): string {
  return element.style.getPropertyValue(property).trim()
}

/**
 * Word, Google Docs and Notion stamp an explicit near-black `color` on almost
 * every span. Wrapping those in `<font>` fills the document with markup for
 * text that is not coloured at all, so treat neutral near-black as "no colour".
 * Anything a user would recognise as a colour (including dark reds and blues,
 * which are not neutral) is kept.
 */
function isDefaultTextColor(hex: string): boolean {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const max = Math.max(...channels)
  return max <= 0x40 && max - Math.min(...channels) <= 0x10
}

/**
 * Collapse `<font c>A</font><font c>B</font>` (and the same for `<mark>`) into
 * one wrapper.每个源元素各包一层，一段颜色相同的文字被源 HTML 拆成几个 span 时，
 * 粘进来就是一串碎片标签。只合并相邻、同色、且内部没有同名嵌套的两段。
 */
export function mergeAdjacentInlineWrappers(markdown: string): string {
  const patterns = [
    /<font color="(#[\da-f]{6})">((?:(?!<\/?font)[\s\S])*)<\/font><font color="\1">/gi,
    /<mark style="background-color:(#[\da-f]{6})">((?:(?!<\/?mark)[\s\S])*)<\/mark><mark style="background-color:\1">/gi,
  ]
  let result = markdown
  for (const pattern of patterns) {
    let previous: string
    do {
      previous = result
      result = result.replace(pattern, (_match, color: string, inner: string) =>
        pattern.source.startsWith('<font')
          ? `<font color="${color}">${inner}`
          : `<mark style="background-color:${color}">${inner}`,
      )
    } while (result !== previous)
  }
  return result
}

function isHidden(element: HTMLElement): boolean {
  return (
    styleValue(element, 'display').toLowerCase() === 'none' ||
    styleValue(element, 'visibility').toLowerCase() === 'hidden' ||
    /mso-hide\s*:\s*all/i.test(element.getAttribute('style') ?? '')
  )
}

function wrapInlineStyle(element: HTMLElement, value: string): string {
  if (!value) return value
  const tag = element.tagName
  const weight = styleValue(element, 'font-weight').toLowerCase()
  const decoration = styleValue(element, 'text-decoration').toLowerCase()
  const italic =
    tag === 'I' || tag === 'EM' || styleValue(element, 'font-style').toLowerCase() === 'italic'
  const bold =
    tag === 'B' ||
    tag === 'STRONG' ||
    weight === 'bold' ||
    weight === 'bolder' ||
    Number.parseInt(weight, 10) >= 600
  const strike =
    tag === 'DEL' || tag === 'S' || tag === 'STRIKE' || decoration.includes('line-through')
  const underline = tag === 'U' || decoration.includes('underline')
  const rawColor = cssColor(
    tag === 'FONT' ? (element.getAttribute('color') ?? '') : styleValue(element, 'color'),
  )
  const color = rawColor && isDefaultTextColor(rawColor) ? null : rawColor
  const background = cssColor(styleValue(element, 'background-color'))

  let result = value
  if (bold) result = `**${result}**`
  if (italic) result = `*${result}*`
  if (strike) result = `~~${result}~~`
  if (underline) result = `<u>${result}</u>`
  if (color) result = `<font color="${color}">${result}</font>`
  if (tag === 'MARK' || background) {
    result = background
      ? `<mark style="background-color:${background}">${result}</mark>`
      : `<mark>${result}</mark>`
  }
  if (tag === 'SUB') result = `<sub>${result}</sub>`
  if (tag === 'SUP') result = `<sup>${result}</sup>`
  return result
}

function inlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.textContent ?? '')
  if (!(node instanceof HTMLElement) || isHidden(node)) return ''
  if (['HEAD', 'META', 'SCRIPT', 'STYLE', 'TITLE'].includes(node.tagName)) return ''
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'IMG') {
    const href = destination(node.getAttribute('src') ?? '', true)
    if (!href) return escapeMarkdownText(node.getAttribute('alt') ?? '')
    return `![${escapeMarkdownText(node.getAttribute('alt') ?? '')}](${href})`
  }
  if (node.tagName === 'CODE' && node.parentElement?.tagName !== 'PRE') {
    return inlineCode(node.textContent ?? '')
  }

  const content = Array.from(node.childNodes, inlineNode).join('')
  if (node.tagName === 'A') {
    const href = destination(node.getAttribute('href') ?? '')
    return href ? `[${content || escapeMarkdownText(href)}](${href})` : content
  }
  return wrapInlineStyle(node, content)
}

function inlineChildren(element: Element): string {
  return Array.from(element.childNodes, inlineNode)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

function listItemBody(item: Element): string {
  const holder = item.ownerDocument.createElement('div')
  for (const child of Array.from(item.childNodes)) {
    if (child instanceof HTMLElement && ['OL', 'UL'].includes(child.tagName)) continue
    holder.append(child.cloneNode(true))
  }
  return blockChildren(holder).trim()
}

function indentContinuation(value: string, width: number): string {
  const padding = ' '.repeat(width)
  return value
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${padding}${line}`))
    .join('\n')
}

function listToMarkdown(list: HTMLElement): string {
  const ordered = list.tagName === 'OL'
  const start = Number.parseInt(list.getAttribute('start') ?? '1', 10)
  const items = Array.from(list.children).filter((child) => child.tagName === 'LI')
  return items
    .map((item, index) => {
      const marker = ordered ? `${Number.isFinite(start) ? start + index : index + 1}. ` : '- '
      const task = item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]')
      const taskPrefix = task ? `[${task.checked ? 'x' : ' '}] ` : ''
      const body = indentContinuation(`${taskPrefix}${listItemBody(item)}`.trim(), marker.length)
      const nested = Array.from(item.children)
        .filter((child): child is HTMLElement => ['OL', 'UL'].includes(child.tagName))
        .map((child) =>
          listToMarkdown(child)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        )
        .join('\n')
      return `${marker}${body}${nested ? `\n${nested}` : ''}`.trimEnd()
    })
    .join('\n')
}

function codeBlock(element: HTMLElement): string {
  const code = element.querySelector('code')
  const value = (code?.textContent ?? element.textContent ?? '').replace(/\n$/, '')
  const language =
    code?.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] ??
    code?.getAttribute('data-language') ??
    ''
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${value}\n${fence}`
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''
  const cells = rows.map((row) =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
      escapeTableCell(inlineChildren(cell)),
    ),
  )
  const width = Math.max(1, ...cells.map((row) => row.length))
  const hasHeader = Array.from(rows[0].children).some((cell) => cell.tagName === 'TH')
  const header = hasHeader ? cells[0] : Array.from({ length: width }, () => '')
  const body = hasHeader ? cells.slice(1) : cells
  const alignment = Array.from(rows[0].querySelectorAll(':scope > th, :scope > td')).map((cell) => {
    const value = (
      cell.getAttribute('align') ??
      (cell instanceof HTMLElement ? styleValue(cell, 'text-align') : '')
    ).toLowerCase()
    if (value === 'center') return ':---:'
    if (value === 'right') return '---:'
    return '---'
  })
  while (alignment.length < width) alignment.push('---')
  const row = (values: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => values[index] ?? '').join(' | ')} |`
  return [row(header), row(alignment), ...body.map(row)].join('\n')
}

function wordHeadingLevel(element: HTMLElement): number | null {
  const classLevel = /(?:^|\s)MsoHeading([1-6])(?:\s|$)/i.exec(element.className)?.[1]
  if (classLevel) return Number(classLevel)
  if (/(?:^|\s)MsoTitle(?:\s|$)/i.test(element.className)) return 1
  const outline = /mso-outline-level\s*:\s*([0-5])/i.exec(element.getAttribute('style') ?? '')?.[1]
  return outline === undefined ? null : Number(outline) + 1
}

function wordListItem(element: HTMLElement): string | null {
  const style = element.getAttribute('style') ?? ''
  const list = /mso-list\s*:[^;]*/i.exec(style)
  if (!list && !/(?:^|\s)MsoListParagraph/i.test(element.className)) return null
  const clone = element.cloneNode(true) as HTMLElement
  const ignoredMarkers = Array.from(clone.querySelectorAll<HTMLElement>('[style]')).filter((node) =>
    /mso-list\s*:\s*ignore/i.test(node.getAttribute('style') ?? ''),
  )
  const markerText = ignoredMarkers.map((node) => node.textContent ?? '').join('')
  ignoredMarkers.forEach((node) => node.remove())
  const ordered = /^\s*(?:\d+|[a-z])[.)]/i.test(markerText)
  const level = Math.max(1, Number(/\blevel(\d+)/i.exec(list?.[0] ?? '')?.[1] ?? 1))
  const content = inlineChildren(clone).replace(/^(?:[•·▪◦o]|\d+[.)])\s*/i, '')
  return `${'  '.repeat(level - 1)}${ordered ? '1. ' : '- '}${content}\n`
}

function blockNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ? escapeMarkdownText(node.textContent) : ''
  }
  if (!(node instanceof HTMLElement) || isHidden(node)) return ''
  const tag = node.tagName
  if (['HEAD', 'META', 'SCRIPT', 'STYLE', 'TITLE'].includes(tag)) return ''
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineChildren(node)}\n\n`
  if (tag === 'P') {
    const listItem = wordListItem(node)
    if (listItem) return listItem
    const headingLevel = wordHeadingLevel(node)
    return headingLevel
      ? `${'#'.repeat(headingLevel)} ${inlineChildren(node)}\n\n`
      : `${inlineChildren(node)}\n\n`
  }
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return '---\n\n'
  if (tag === 'PRE') return `${codeBlock(node)}\n\n`
  if (tag === 'UL' || tag === 'OL') return `${listToMarkdown(node)}\n\n`
  if (tag === 'BLOCKQUOTE') {
    const content = blockChildren(node).trim()
    return `${content
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')}\n\n`
  }
  if (tag === 'TABLE') return `${tableToMarkdown(node)}\n\n`

  const directBlock = Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName))
  if (directBlock) return blockChildren(node)
  if (BLOCK_TAGS.has(tag)) {
    const content = inlineChildren(node)
    return content ? `${content}\n\n` : ''
  }
  return inlineNode(node)
}

function blockChildren(element: Element): string {
  return Array.from(element.childNodes, blockNode).join('')
}

function normalizeConvertedMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Prefer the exact source carried by Xiangzi MD. For other rich clipboard
 * producers, convert common semantic/Word-style HTML into editable Markdown.
 */
export function markdownFromClipboardHtml(html: string): string | null {
  if (!html.trim()) return null
  const document = new DOMParser().parseFromString(html, 'text/html')
  const embedded = embeddedMarkdownSource(document)
  if (embedded !== null) return embedded
  const converted = mergeAdjacentInlineWrappers(
    normalizeConvertedMarkdown(blockChildren(document.body)),
  )
  return converted || null
}
