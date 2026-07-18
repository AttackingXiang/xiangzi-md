/**
 * The reveal-policy table: the single source of truth for how a Markdown
 * syntax-tree node behaves in the live-preview surface.
 *
 * A policy only classifies a node name. It does not by itself compute which
 * source characters are hidden for a given node instance (that is Markdown-
 * construct-specific and lives with the feature that owns the construct,
 * e.g. `livePreview.ts`). What the policy buys the rest of the engine is a
 * shared, declarative answer to "does this node ever reveal its source, and
 * under what condition" so `revealState.ts` and `hiddenRanges.ts` do not
 * need construct-specific knowledge.
 */
export type RevealPolicyKind = 'reveal-on-selection' | 'always-hidden' | 'widget' | 'atomic-block'

export interface NodePolicy {
  kind: RevealPolicyKind
}

/**
 * Inline formatting markers (`**`, `_`, `~~`, `` ` ``, link brackets/target).
 * Obsidian-like editing semantics: hidden while the caret is outside the
 * construct, shown verbatim when a collapsed caret enters it. Non-empty
 * selections keep the rendered form stable. Driven by `revealState.ts`.
 */
const REVEAL_ON_SELECTION = new Set([
  'StrongEmphasis',
  'Emphasis',
  'Strikethrough',
  'InlineCode',
  'Link',
  'Autolink',
])

/**
 * Source that is never shown, regardless of selection (Typora semantics).
 * Must be hidden + atomic, and — where it prefixes a line the user edits,
 * such as an ATX heading `#` — must never capture a click (see
 * `linePositionAtPointer` in livePreview.ts).
 */
const ALWAYS_HIDDEN = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'HorizontalRule',
  'LinkReference',
])

/**
 * Source that is rendered as styling or a small interactive widget instead
 * of raw characters (list bullets/numbers, task checkboxes, blockquote
 * bars, callout labels). Like `always-hidden`, the source marker is never
 * revealed by selection — the difference is purely which decoration paints
 * over it.
 */
const WIDGET = new Set(['ListMark', 'TaskMarker', 'QuoteMark'])

/**
 * Node names whose source is hidden as a whole cross-line unit rather than
 * per-line (see core/README.md, invariant 2's `atomic-block` exception).
 * Fenced code (`codeBlockPreview.ts`) registers its fence lines through
 * `hiddenRangeSource` with `paint: false` and was the first construct to use
 * this policy — see `core/hiddenRanges.ts` for why an `atomic-block` range
 * is allowed to cross its own trailing newline while Phase 1's inline
 * hidden ranges are not. `tablePreview.ts` (`Table`) and `imagePreview.ts`
 * (`Image`) followed in Phase 3, each registering their widget's exact
 * replace span (`table.from`..`table.to` / `match.from`..`match.to`) with
 * `paint: false` since their own decoration set already paints the widget.
 *
 * Indented code blocks (`CodeBlock`) are intentionally not registered here:
 * live preview does not currently hide or restyle their source at all (no
 * card, no hidden markers), so there is nothing that needs to be atomic.
 *
 * Math expressions and Mermaid diagrams are *not* listed here even though
 * `mathPreview.ts`/`mermaidPreview.ts` also register `atomic-block` ranges
 * through `hiddenRangeSource`: neither is discovered by Lezer node name.
 * Math spans are found by a manual `$...$`/`$$...$$` text scan (no dedicated
 * syntax node), and Mermaid diagrams are `FencedCode` nodes distinguished
 * only by their language info string — already covered by the `FencedCode`
 * entry above, and explicitly excluded from `codeBlockPreview.ts`'s own
 * fence-line handling (see `collectFencedCodeHiddenRanges`) so the two
 * modules never double-register the same span.
 */
export const ATOMIC_BLOCK_NAMES = new Set<string>(['FencedCode', 'Table', 'Image'])

export const HEADING_NODE_NAMES: ReadonlyMap<string, number> = new Map([
  ['ATXHeading1', 1],
  ['ATXHeading2', 2],
  ['ATXHeading3', 3],
  ['ATXHeading4', 4],
  ['ATXHeading5', 5],
  ['ATXHeading6', 6],
  ['SetextHeading1', 1],
  ['SetextHeading2', 2],
])

export function policyFor(nodeName: string): NodePolicy | null {
  if (REVEAL_ON_SELECTION.has(nodeName)) return { kind: 'reveal-on-selection' }
  if (ALWAYS_HIDDEN.has(nodeName)) return { kind: 'always-hidden' }
  if (WIDGET.has(nodeName)) return { kind: 'widget' }
  if (ATOMIC_BLOCK_NAMES.has(nodeName)) return { kind: 'atomic-block' }
  return null
}
