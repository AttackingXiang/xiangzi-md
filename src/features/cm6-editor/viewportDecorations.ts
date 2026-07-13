import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export type ViewportDecorationBuilder = (view: EditorView) => DecorationSet

export interface ViewportDecorationOptions {
  atomic?: boolean
  rebuildOnSelection?: boolean
  /** Rebuild after CodeMirror's background parser publishes a more complete syntax tree. */
  rebuildOnSyntaxTree?: boolean
  /** Rebuild for a feature-owned state effect that doesn't otherwise change the view. */
  rebuildOnUpdate?: (update: ViewUpdate) => boolean
}

interface ViewportDecorationUpdateReason {
  docChanged: boolean
  selectionSet: boolean
  viewportChanged: boolean
  syntaxTreeChanged: boolean
}

export function shouldRebuildViewportDecorations(
  update: ViewportDecorationUpdateReason,
  options: ViewportDecorationOptions,
): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    (options.rebuildOnSelection !== false && update.selectionSet) ||
    (options.rebuildOnSyntaxTree === true && update.syntaxTreeChanged)
  )
}

/**
 * Hosts vertically significant decorations in a StateField, as CM6 requires.
 * The plugin only observes the view and schedules an effect outside update().
 */
export function viewportDecorationExtension(
  build: ViewportDecorationBuilder,
  options: ViewportDecorationOptions = {},
): Extension {
  const replaceDecorations = StateEffect.define<DecorationSet>()
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(replaceDecorations)) return effect.value
      }
      return transaction.docChanged ? value.map(transaction.changes) : value
    },
    provide: (source) => [
      EditorView.decorations.from(source),
      ...(options.atomic
        ? [EditorView.atomicRanges.from(source, (decorations) => () => decorations)]
        : []),
    ],
  })

  const observer = ViewPlugin.fromClass(
    class {
      private scheduled = false
      private destroyed = false
      private dispatching = false

      constructor(readonly view: EditorView) {
        this.schedule()
      }

      update(update: ViewUpdate): void {
        if (this.dispatching) return
        if (
          shouldRebuildViewportDecorations(
            {
              docChanged: update.docChanged,
              selectionSet: update.selectionSet,
              viewportChanged: update.viewportChanged,
              syntaxTreeChanged:
                options.rebuildOnSyntaxTree === true &&
                syntaxTree(update.startState) !== syntaxTree(update.state),
            },
            options,
          ) || options.rebuildOnUpdate?.(update) === true
        ) {
          this.schedule()
        }
      }

      destroy(): void {
        this.destroyed = true
      }

      private schedule(): void {
        if (this.scheduled || this.destroyed) return
        this.scheduled = true
        queueMicrotask(() => {
          this.scheduled = false
          if (this.destroyed) return
          const decorations = build(this.view)
          this.dispatching = true
          try {
            this.view.dispatch({ effects: replaceDecorations.of(decorations) })
          } finally {
            this.dispatching = false
          }
        })
      }
    },
  )

  return [field, observer]
}
