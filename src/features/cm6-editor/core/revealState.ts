import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { cm6ExportMode } from './exportMode'
import { policyFor } from './nodePolicy'
import { mergeRanges, rangesTouch, type PreviewRange } from './types'

/**
 * The set of `reveal-on-selection` construct ranges that the current
 * caret currently touches. Built fresh whenever the selection or the document
 * changes; cheap because it only walks the ancestry of collapsed selection
 * endpoints, never the whole document. Non-empty selections intentionally keep
 * rendered Markdown stable instead of revealing source markers while dragging.
 */
export interface RevealedRanges {
  readonly ranges: readonly PreviewRange[]
}

const EMPTY_REVEALED: RevealedRanges = { ranges: [] }

/** Freezes rendered inline geometry for the duration of a pointer selection. */
export const setPointerSelectionActive = StateEffect.define<boolean>()

export const pointerSelectionActiveState = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPointerSelectionActive)) value = effect.value
    }
    return value
  },
})

function collectAncestors(node: SyntaxNode | null, into: PreviewRange[]): void {
  for (let current = node; current; current = current.parent) {
    if (policyFor(current.name)?.kind === 'reveal-on-selection') {
      into.push({ from: current.from, to: current.to })
    }
  }
}

/** Pure function: computes revealed construct ranges for `state.selection`. */
export function computeRevealedRanges(state: EditorState): RevealedRanges {
  if (state.facet(cm6ExportMode) || state.field(pointerSelectionActiveState, false)) {
    return EMPTY_REVEALED
  }
  const tree = syntaxTree(state)
  const collected: PreviewRange[] = []

  for (const range of state.selection.ranges) {
    // A range selection is a formatting/copy/navigation action. Revealing
    // markers here changes inline width while the pointer is moving, which can
    // reflow the line and make CM6's measured selection layer flash across an
    // entire visual row. Source is revealed only after the range collapses to
    // a caret inside the construct.
    if (!range.empty) continue
    collectAncestors(tree.resolveInner(range.head, 1), collected)
    collectAncestors(tree.resolveInner(range.head, -1), collected)
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
    const pointerSelectionChanged = transaction.effects.some((effect) =>
      effect.is(setPointerSelectionActive),
    )
    if (
      !transaction.docChanged &&
      transaction.selection === undefined &&
      !pointerSelectionChanged
    ) {
      return value
    }
    return computeRevealedRanges(transaction.state)
  },
})
