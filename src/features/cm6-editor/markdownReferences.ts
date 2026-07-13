import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'

export interface MarkdownReferenceDefinition {
  from: number
  to: number
  destination: string
  title?: string
}

const referenceCache = new WeakMap<Tree, ReadonlyMap<string, MarkdownReferenceDefinition>>()

const namedEntities: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeMarkdownEntity(entity: string): string {
  const numeric = /^&#(x[\da-f]+|\d+);$/i.exec(entity)?.[1]
  if (numeric) {
    const value = Number.parseInt(numeric.replace(/^x/i, ''), /^x/i.test(numeric) ? 16 : 10)
    if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) {
      try {
        return String.fromCodePoint(value)
      } catch {
        return '\ufffd'
      }
    }
    return '\ufffd'
  }
  return namedEntities[entity.slice(1, -1).toLowerCase()] ?? entity
}

/** Decode the Markdown escapes/entities that are meaningful in labels and destinations. */
export function decodeMarkdownReferenceText(value: string): string {
  return value
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
    .replace(/&#(?:x[\da-f]+|\d+);|&(?:amp|apos|gt|lt|nbsp|quot);/gi, decodeMarkdownEntity)
}

/** CommonMark reference labels are case-insensitive with collapsed whitespace. */
export function normalizeMarkdownReferenceLabel(value: string): string {
  return decodeMarkdownReferenceText(value).trim().replace(/\s+/gu, ' ').toLowerCase()
}

function stripPair(value: string, opening: string, closing: string): string {
  return value.startsWith(opening) && value.endsWith(closing)
    ? value.slice(opening.length, value.length - closing.length)
    : value
}

export function decodeMarkdownDestination(value: string): string {
  return decodeMarkdownReferenceText(stripPair(value.trim(), '<', '>'))
}

function decodeMarkdownTitle(value: string): string {
  const trimmed = value.trim()
  const unwrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : stripPair(trimmed, '(', ')')
  return decodeMarkdownReferenceText(unwrapped)
}

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

/**
 * Build one definition index per Lezer tree. The WeakMap lets link and image
 * previews share it, while syntax-tree replacement naturally invalidates it.
 */
export function markdownReferenceDefinitions(
  state: EditorState,
): ReadonlyMap<string, MarkdownReferenceDefinition> {
  const tree = syntaxTree(state)
  const cached = referenceCache.get(tree)
  if (cached) return cached

  const definitions = new Map<string, MarkdownReferenceDefinition>()
  tree.iterate({
    enter(node) {
      if (node.name !== 'LinkReference') return
      const labelNode = directChild(node.node, 'LinkLabel')
      const urlNode = directChild(node.node, 'URL')
      if (!labelNode || !urlNode) return false
      const rawLabel = state.doc.sliceString(
        labelNode.from + 1,
        Math.max(labelNode.from + 1, labelNode.to - 1),
      )
      const label = normalizeMarkdownReferenceLabel(rawLabel)
      const destination = decodeMarkdownDestination(state.doc.sliceString(urlNode.from, urlNode.to))
      if (!label || !destination || definitions.has(label)) return false
      const titleNode = directChild(node.node, 'LinkTitle')
      definitions.set(label, {
        from: node.from,
        to: node.to,
        destination,
        ...(titleNode
          ? { title: decodeMarkdownTitle(state.doc.sliceString(titleNode.from, titleNode.to)) }
          : {}),
      })
      return false
    },
  })
  referenceCache.set(tree, definitions)
  return definitions
}

/** Resolve a full/collapsed/shortcut reference, falling back to visible text. */
export function resolveMarkdownReference(
  state: EditorState,
  explicitLabel: string | null,
  visibleText: string,
): MarkdownReferenceDefinition | null {
  const rawLabel = explicitLabel && explicitLabel.length > 0 ? explicitLabel : visibleText
  const label = normalizeMarkdownReferenceLabel(rawLabel)
  return label ? (markdownReferenceDefinitions(state).get(label) ?? null) : null
}
