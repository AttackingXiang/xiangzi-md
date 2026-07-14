import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { decodeMarkdownDestination, resolveMarkdownReference } from './markdownReferences'
import type { PreviewRange } from './core/types'

/** Only allow schemes/targets that are safe to navigate to from live preview. */
export function safeMarkdownLinkHref(href: string): string | null {
  const normalized = href.trim()
  if (!normalized || /[\u0000-\u001f\u007f\\]/.test(normalized)) return null
  if (normalized.startsWith('//')) return null

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return null
  return normalized
}

export interface MarkdownLinkData {
  labelFrom: number
  labelTo: number
  href: string
  hidden: PreviewRange[]
}

/** Resolve a Link/Autolink/bare-URL syntax node to its visible label and safe href. */
export function markdownLinkData(state: EditorState, node: SyntaxNode): MarkdownLinkData | null {
  if (node.name === 'URL') {
    const text = state.doc.sliceString(node.from, node.to)
    const detectedHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
      ? `mailto:${text}`
      : /^www\./i.test(text)
        ? `https://${text}`
        : text
    const safeHref = safeMarkdownLinkHref(detectedHref)
    return safeHref ? { labelFrom: node.from, labelTo: node.to, href: safeHref, hidden: [] } : null
  }

  const marks: SyntaxNode[] = []
  let urlNode: SyntaxNode | null = null
  let labelNode: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') marks.push(child)
    if (child.name === 'URL') urlNode = child
    if (child.name === 'LinkLabel') labelNode = child
  }
  if (node.name === 'Autolink') {
    if (!urlNode) return null
    const text = state.doc.sliceString(urlNode.from, urlNode.to)
    const href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : text
    const safeHref = safeMarkdownLinkHref(href)
    return safeHref
      ? {
          labelFrom: urlNode.from,
          labelTo: urlNode.to,
          href: safeHref,
          hidden: [
            { from: node.from, to: urlNode.from },
            { from: urlNode.to, to: node.to },
          ],
        }
      : null
  }
  if (node.name !== 'Link' || marks.length < 2) return null

  const labelFrom = marks[0].to
  const labelTo = marks[1].from
  const visibleLabel = state.doc.sliceString(labelFrom, labelTo)
  const explicitLabel = labelNode
    ? state.doc.sliceString(labelNode.from + 1, Math.max(labelNode.from + 1, labelNode.to - 1))
    : null
  const definition = urlNode ? null : resolveMarkdownReference(state, explicitLabel, visibleLabel)
  const href = urlNode
    ? decodeMarkdownDestination(state.doc.sliceString(urlNode.from, urlNode.to))
    : (definition?.destination ?? '')
  const safeHref = safeMarkdownLinkHref(href)
  return labelFrom >= 0 && labelTo >= labelFrom && safeHref
    ? {
        labelFrom,
        labelTo,
        href: safeHref,
        hidden: [
          { from: node.from, to: labelFrom },
          { from: labelTo, to: node.to },
        ],
      }
    : null
}
