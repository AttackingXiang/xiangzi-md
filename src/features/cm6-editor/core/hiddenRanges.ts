import { syntaxTree } from '@codemirror/language'
import { Facet, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  computeRevealedRanges,
  pointerSelectionActiveState,
  revealState,
  type RevealedRanges,
} from './revealState'
import type { PreviewRange } from './types'
import { HIDDEN_SOURCE_ATTRIBUTE } from '../../../lib/hiddenSourceDom'

export type HiddenRangePresentation = 'replace' | 'preserve-text' | 'external'

export const PRESERVED_HIDDEN_SOURCE_CLASS = 'xmd-cm-preserved-hidden-source'

export interface HiddenRange extends PreviewRange {
  /**
   * How the source is represented in the editor DOM. Atomic cursor behaviour
   * is independent from this choice and is always installed for the range.
   *
   * - `replace` (default): remove source text from layout with a replacement.
   * - `preserve-text`: keep addressable text nodes and collapse them visually.
   * - `external`: let the owning feature paint its own widget/decoration.
   */
  presentation?: HiddenRangePresentation
}

export interface HiddenRangeContext {
  state: EditorState
  visibleRanges: readonly PreviewRange[]
  revealed: RevealedRanges
}

export type HiddenRangeBuilder = (context: HiddenRangeContext) => readonly HiddenRange[]

/**
 * Every feature that hides or atomizes source characters registers exactly
 * one builder here instead of standing up its own `EditorView.atomicRanges`
 * provider. `hiddenRangesEngine()` aggregates all of them into a single
 * atomic-ranges provider and a single presentation decoration set. This lets
 * independently-authored preview features share an editor without their
 * atomic ranges or painting strategies fighting (see core/README.md).
 */
export const hiddenRangeSource = Facet.define<HiddenRangeBuilder>()

export interface HiddenRangeSets {
  decorations: DecorationSet
  atomic: DecorationSet
}

/**
 * Preserve every consecutive core-painted source range at a physical line's
 * visual start. The chain may contain indentation and multiple constructs
 * (`> # **title**`), but stops at the first visible character or feature-owned
 * widget. Whole-line and cross-line ranges stay replacements because they do
 * not border editable content on that line.
 */
export function preserveLineLeadingHiddenSource(
  state: EditorState,
  ranges: readonly HiddenRange[],
): HiddenRange[] {
  const normalized = ranges.map((range) => ({ ...range }))
  const byLine = new Map<number, number[]>()

  normalized.forEach((range, index) => {
    const line = state.doc.lineAt(range.from)
    if (range.to > line.to) return
    const indexes = byLine.get(line.from)
    if (indexes) indexes.push(index)
    else byLine.set(line.from, [index])
  })

  for (const [lineFrom, indexes] of byLine) {
    const line = state.doc.lineAt(lineFrom)
    let cursor = line.from
    indexes.sort((left, right) => {
      const leftRange = normalized[left]
      const rightRange = normalized[right]
      return leftRange.from - rightRange.from || leftRange.to - rightRange.to
    })

    for (const index of indexes) {
      const range = normalized[index]
      const presentation = range.presentation ?? 'replace'
      const gap = state.doc.sliceString(cursor, range.from)
      const visibleAfter = state.doc.sliceString(range.to, line.to).trim().length > 0
      if (
        range.from < cursor ||
        !/^[\t ]*$/.test(gap) ||
        !visibleAfter ||
        presentation === 'external'
      ) {
        break
      }
      if (presentation === 'replace') range.presentation = 'preserve-text'
      cursor = range.to
    }
  }

  return normalized
}

/** Build atomic and visual sets from already-discovered hidden ranges. */
export function buildHiddenRangeSets(
  state: EditorState,
  ranges: Iterable<HiddenRange>,
): HiddenRangeSets {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const atomic: Array<ReturnType<Decoration['range']>> = []

  for (const range of preserveLineLeadingHiddenSource(state, Array.from(ranges))) {
    if (range.to <= range.from) continue
    atomic.push(Decoration.replace({}).range(range.from, range.to))

    const presentation = range.presentation ?? 'replace'
    switch (presentation) {
      case 'replace':
        decorations.push(Decoration.replace({}).range(range.from, range.to))
        break
      case 'preserve-text':
        decorations.push(
          Decoration.mark({
            class: PRESERVED_HIDDEN_SOURCE_CLASS,
            attributes: {
              [HIDDEN_SOURCE_ATTRIBUTE]: 'true',
              'aria-hidden': 'true',
            },
          }).range(range.from, range.to),
        )
        break
      case 'external':
        break
      default: {
        const exhaustive: never = presentation
        throw new Error(`Unsupported hidden-range presentation: ${String(exhaustive)}`)
      }
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  }
}

/**
 * Pure aggregation step: gathers every registered builder's contributions for
 * `state`/`visibleRanges` into one atomic set and one presentation set.
 * Factored out of the ViewPlugin below so it can be unit tested without a
 * real `EditorView` (this package's tests run without a DOM).
 */
export function aggregateHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  revealed?: RevealedRanges,
): HiddenRangeSets {
  const builders = state.facet(hiddenRangeSource)
  if (builders.length === 0) return { decorations: Decoration.none, atomic: Decoration.none }

  const context: HiddenRangeContext = {
    state,
    visibleRanges,
    revealed: revealed ?? computeRevealedRanges(state),
  }

  const ranges: HiddenRange[] = []
  for (const build of builders) {
    for (const range of build(context)) {
      ranges.push(range)
    }
  }
  return buildHiddenRangeSets(state, ranges)
}

function buildSets(view: EditorView): HiddenRangeSets {
  const visibleRanges: PreviewRange[] = view.visibleRanges.map(({ from, to }) => ({ from, to }))
  return aggregateHiddenRanges(view.state, visibleRanges, view.state.field(revealState, false))
}

/**
 * Installs the shared reveal-state field plus the single aggregated
 * atomic-ranges/hidden-decoration provider. Features contribute via
 * `hiddenRangeSource.of(builder)`; this extension must be included exactly
 * once per editor (`markdownLivePreview()` does so).
 */
export function hiddenRangesEngine(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      atomic: DecorationSet

      constructor(view: EditorView) {
        const built = buildSets(view)
        this.decorations = built.decorations
        this.atomic = built.atomic
      }

      update(update: ViewUpdate): void {
        // See the matching guard in livePreview.ts's `paint` plugin: a full
        // rebuild creates new Decoration objects even at unchanged
        // positions, and CM6 diffs replace decorations by reference, so it
        // touches that DOM again on every keystroke — including the
        // always-hidden marker immediately before wherever the user is
        // typing. Doing that mid-IME-composition drops the composition.
        // Remapping instead of rebuilding keeps positions correct without
        // disturbing decoration identity; the deferred rebuild runs on the
        // next update once composition ends (its own commit is a
        // doc-changing transaction, so that update always follows).
        if (update.view.compositionStarted) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes)
            this.atomic = this.atomic.map(update.changes)
          }
          return
        }
        const syntaxTreeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.geometryChanged ||
          syntaxTreeChanged
        ) {
          const built = buildSets(update.view)
          this.decorations = built.decorations
          this.atomic = built.atomic
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
      provide: (instance) =>
        EditorView.atomicRanges.of((view) => view.plugin(instance)?.atomic ?? Decoration.none),
    },
  )
  return [pointerSelectionActiveState, revealState, plugin]
}
