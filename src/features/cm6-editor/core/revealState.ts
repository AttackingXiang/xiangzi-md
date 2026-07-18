import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { StateField } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { cm6ExportMode } from './exportMode'
import { policyFor } from './nodePolicy'
import { mergeRanges, rangesTouch, type PreviewRange } from './types'

/**
 * The set of `reveal-on-selection` construct ranges that the current
 * selection currently touches. Built fresh whenever the selection or the
 * document changes; cheap because it only walks the ancestry of each
 * selection endpoint (or the small span a non-empty selection covers), never
 * the whole document.
 */
export interface RevealedRanges {
  readonly ranges: readonly PreviewRange[]
}

const EMPTY_REVEALED: RevealedRanges = { ranges: [] }

function collectAncestors(node: SyntaxNode | null, into: PreviewRange[]): void {
  for (let current = node; current; current = current.parent) {
    if (policyFor(current.name)?.kind === 'reveal-on-selection') {
      into.push({ from: current.from, to: current.to })
    }
  }
}

/** Pure function: computes revealed construct ranges for `state.selection`. */
export function computeRevealedRanges(state: EditorState): RevealedRanges {
  if (state.facet(cm6ExportMode)) return EMPTY_REVEALED
  const tree = syntaxTree(state)
  const collected: PreviewRange[] = []

  for (const range of state.selection.ranges) {
    // Selecting the whole document is a document-level clipboard/navigation
    // action, not a request to edit every inline construct at once. Revealing
    // all Markdown markers here makes the DOM copied by CodeMirror contain
    // `**`, backticks, link destinations, and other source syntax instead of
    // the rendered document the user selected.
    if (range.from === 0 && range.to === state.doc.length && !range.empty) continue
    if (range.empty) {
      collectAncestors(tree.resolveInner(range.head, 1), collected)
      collectAncestors(tree.resolveInner(range.head, -1), collected)
      continue
    }
    // A non-empty selection may fully contain a construct without either
    // endpoint sitting inside it (e.g. selecting a whole "**bold** word").
    // Bound the tree walk to the selection span so this stays cheap.
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (policyFor(node.name)?.kind === 'reveal-on-selection') {
          collected.push({ from: node.from, to: node.to })
        }
      },
    })
    collectAncestors(tree.resolveInner(range.from, -1), collected)
    collectAncestors(tree.resolveInner(range.to, 1), collected)
  }

  return collected.length === 0 ? EMPTY_REVEALED : { ranges: mergeRanges(collected) }
}

/** Whether `[from, to)` overlaps a currently-revealed construct range. */
export function isRevealed(revealed: RevealedRanges, from: number, to: number): boolean {
  const probe = { from, to }
  return revealed.ranges.some((range) => rangesTouch(range, probe))
}

/** Holds the current `RevealedRanges`, recomputed on doc/selection changes. */
export const revealState = StateField.define<RevealedRanges>({
  create: (state) => computeRevealedRanges(state),
  update(value, transaction) {
    if (!transaction.docChanged && transaction.selection === undefined) return value
    return computeRevealedRanges(transaction.state)
  },
})
