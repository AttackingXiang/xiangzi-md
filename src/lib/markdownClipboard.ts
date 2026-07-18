import type { SyntaxNode } from '@lezer/common'
import { GFM, parser as markdownParser } from '@lezer/markdown'

const parser = markdownParser.configure([GFM])

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
  return result
}

function safeHref(value: string, image = false): string | null {
  const href = value.trim().replace(/^<|>$/g, '')
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  if (!scheme) return href
  const allowed = image ? ['http', 'https', 'xmd'] : ['http', 'https', 'mailto']
  return allowed.includes(scheme) ? href : null
}

function inlineRange(source: string, from: number, to: number, nodes: SyntaxNode[]): string {
  let html = ''
  let cursor = from
  for (const node of nodes) {
    if (node.from < from || node.to > to) continue
    if (node.from > cursor) html += escapeText(source.slice(cursor, node.from))
    html += inlineNode(source, node)
    cursor = Math.max(cursor, node.to)
  }
  if (cursor < to) html += escapeText(source.slice(cursor, to))
  return html
}

function delimitedInline(source: string, node: SyntaxNode, tag: string): string {
  const parts = children(node)
  const first = parts[0]
  const last = parts.at(-1)
  const from = first?.to ?? node.from
  const to = last?.from ?? node.to
  return `<${tag}>${inlineRange(source, from, to, parts.slice(1, -1))}</${tag}>`
}

function linkOrImage(source: string, node: SyntaxNode, image: boolean): string {
  const parts = children(node)
  const marks = parts.filter((part) => part.name === 'LinkMark')
  const url = parts.find((part) => part.name === 'URL')
  const labelFrom = marks[0]?.to ?? node.from
  const labelTo = marks[1]?.from ?? labelFrom
  const labelNodes = parts.filter((part) => part.from >= labelFrom && part.to <= labelTo)
  const labelHtml = inlineRange(source, labelFrom, labelTo, labelNodes)
  const href = url ? safeHref(source.slice(url.from, url.to), image) : null
  if (!href) return image ? escapeText(source.slice(labelFrom, labelTo)) : labelHtml
  if (image) {
    const alt = source.slice(labelFrom, labelTo).replace(/[*_~`]/g, '')
    return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(alt)}">`
  }
  return `<a href="${escapeAttribute(href)}">${labelHtml}</a>`
}

function inlineNode(source: string, node: SyntaxNode): string {
  switch (node.name) {
    case 'StrongEmphasis':
      return delimitedInline(source, node, 'strong')
    case 'Emphasis':
      return delimitedInline(source, node, 'em')
    case 'Strikethrough':
      return delimitedInline(source, node, 'del')
    case 'InlineCode': {
      const parts = children(node)
      const from = parts[0]?.to ?? node.from
      const to = parts.at(-1)?.from ?? node.to
      return `<code>${escapeText(source.slice(from, to))}</code>`
    }
    case 'Link':
      return linkOrImage(source, node, false)
    case 'Image':
      return linkOrImage(source, node, true)
    case 'Autolink': {
      const value = source.slice(node.from + 1, node.to - 1)
      const href = safeHref(value)
      return href
        ? `<a href="${escapeAttribute(href)}">${escapeText(value)}</a>`
        : escapeText(value)
    }
    case 'URL': {
      const value = source.slice(node.from, node.to)
      const href = safeHref(value)
      return href
        ? `<a href="${escapeAttribute(href)}">${escapeText(value)}</a>`
        : escapeText(value)
    }
    case 'Escape':
      return escapeText(source.slice(node.from + 1, node.to))
    case 'Entity':
      return source.slice(node.from, node.to)
    case 'HardBreak':
      return '<br>'
    default: {
      const parts = children(node)
      return parts.length
        ? inlineRange(source, node.from, node.to, parts)
        : escapeText(source.slice(node.from, node.to))
    }
  }
}

function heading(source: string, node: SyntaxNode, level: number): string {
  const parts = children(node)
  const marks = parts.filter((part) => part.name === 'HeaderMark')
  let from = node.from
  let to = node.to
  if (node.name.startsWith('ATX')) {
    from = marks[0]?.to ?? from
    to = marks.length > 1 ? marks.at(-1)!.from : to
    while (from < to && /\s/.test(source[from])) from += 1
    while (to > from && /\s/.test(source[to - 1])) to -= 1
  } else if (marks[0]) {
    to = Math.max(from, marks[0].from - 1)
  }
  const inline = parts.filter((part) => part.name !== 'HeaderMark')
  const size = [2, 1.6, 1.3, 1.15, 1, 0.9][level - 1]
  return `<h${level} style="font-weight:700;font-size:${size}em">${inlineRange(source, from, to, inline)}</h${level}>`
}

function tableRow(source: string, node: SyntaxNode, header: boolean): string {
  const tag = header ? 'th' : 'td'
  const cells = children(node).filter((child) => child.name === 'TableCell')
  return `<tr>${cells
    .map(
      (cell) =>
        `<${tag} style="border:1px solid #d0d7de;padding:6px 10px">${inlineRange(source, cell.from, cell.to, children(cell))}</${tag}>`,
    )
    .join('')}</tr>`
}

function codeBlock(source: string, parts: SyntaxNode[]): string {
  const texts = parts.filter((part) => part.name === 'CodeText')
  const code = texts.map((part) => source.slice(part.from, part.to)).join('\n')
  const info = parts.find((part) => part.name === 'CodeInfo')
  const language = info ? source.slice(info.from, info.to).trim().split(/\s+/, 1)[0] : ''
  // This marker is internal clipboard metadata, not editor DOM styling. The
  // rich-copy pipeline consumes it when Mermaid should become an image and
  // removes it when source copying is requested.
  const mermaidMarker = language?.toLowerCase() === 'mermaid' ? ' data-xmd-mermaid-block' : ''
  return `<pre${mermaidMarker} style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:12px;border-radius:6px"><code>${escapeText(code)}</code></pre>`
}

function blockNode(source: string, node: SyntaxNode): string {
  const parts = children(node)
  const headingMatch = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
  if (headingMatch) return heading(source, node, Number(headingMatch[1]))

  switch (node.name) {
    case 'Document':
      return parts.map((part) => blockNode(source, part)).join('')
    case 'Paragraph':
      return `<p>${inlineRange(source, node.from, node.to, parts)}</p>`
    case 'BulletList':
    case 'OrderedList': {
      const tag = node.name === 'OrderedList' ? 'ol' : 'ul'
      return `<${tag}>${parts
        .filter((part) => part.name === 'ListItem')
        .map((part) => blockNode(source, part))
        .join('')}</${tag}>`
    }
    case 'ListItem':
      return `<li>${parts
        .filter((part) => part.name !== 'ListMark')
        .map((part) => blockNode(source, part))
        .join('')}</li>`
    case 'Task': {
      const marker = parts.find((part) => part.name === 'TaskMarker')
      const checked = marker ? /x/i.test(source.slice(marker.from, marker.to)) : false
      const from = marker?.to ?? node.from
      return `${checked ? '☑' : '☐'} ${inlineRange(
        source,
        from,
        node.to,
        parts.filter((part) => part.name !== 'TaskMarker'),
      ).trimStart()}`
    }
    case 'Blockquote':
      return `<blockquote style="border-left:3px solid #d0d7de;margin-left:0;padding-left:12px">${parts
        .filter((part) => part.name !== 'QuoteMark')
        .map((part) => blockNode(source, part))
        .join('')}</blockquote>`
    case 'FencedCode':
    case 'CodeBlock':
      return codeBlock(source, parts)
    case 'Table': {
      const header = parts.find((part) => part.name === 'TableHeader')
      const rows = parts.filter((part) => part.name === 'TableRow')
      return `<table style="border-collapse:collapse">${header ? `<thead>${tableRow(source, header, true)}</thead>` : ''}<tbody>${rows
        .map((row) => tableRow(source, row, false))
        .join('')}</tbody></table>`
    }
    case 'HorizontalRule':
      return '<hr>'
    default:
      if (parts.length) return parts.map((part) => blockNode(source, part)).join('')
      return `<p>${escapeText(source.slice(node.from, node.to))}</p>`
  }
}

/** Synchronous full-document serializer used when CM6's live DOM is virtualized. */
export function markdownToPortableHtml(source: string): string {
  return blockNode(source, parser.parse(source).topNode)
}
