import { syntaxTree } from '@codemirror/language'
import { Facet, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { computeRevealedRanges, revealState, type RevealedRanges } from './revealState'
import type { PreviewRange } from './types'

export interface HiddenRange extends PreviewRange {
  /**
   * False when the registering feature paints its own decoration (e.g. a
   * list-marker widget) over this exact range. Core always marks the range
   * atomic either way; it only additionally contributes an invisible
   * `Decoration.replace` when `paint` is not `false`.
   */
  paint?: boolean
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
 * atomic-ranges provider and a single "invisible" decoration set, which is
 * the only thing that lets independently-authored preview features share an
 * editor without their atomic ranges fighting (see core/README.md).
 */
export const hiddenRangeSource = Facet.define<HiddenRangeBuilder>()

export interface HiddenRangeSets {
  decorations: DecorationSet
  atomic: DecorationSet
}

/**
 * Pure aggregation step: gathers every registered builder's contributions for
 * `state`/`visibleRanges` into one atomic set and one invisible-paint set.
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

  const paint: Array<ReturnType<Decoration['range']>> = []
  const atomic: Array<ReturnType<Decoration['range']>> = []
  for (const build of builders) {
    for (const range of build(context)) {
      if (range.to <= range.from) continue
      atomic.push(Decoration.replace({}).range(range.from, range.to))
      if (range.paint !== false) paint.push(Decoration.replace({}).range(range.from, range.to))
    }
  }
  return {
    decorations: Decoration.set(paint, true),
    atomic: Decoration.set(atomic, true),
  }
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
  return [revealState, plugin]
}
