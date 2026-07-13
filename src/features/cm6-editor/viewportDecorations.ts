import { StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export type ViewportDecorationBuilder = (view: EditorView) => DecorationSet

/**
 * Hosts vertically significant decorations in a StateField, as CM6 requires.
 * The plugin only observes the view and schedules an effect outside update().
 */
export function viewportDecorationExtension(build: ViewportDecorationBuilder): Extension {
  const replaceDecorations = StateEffect.define<DecorationSet>()
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(replaceDecorations)) return effect.value
      }
      return transaction.docChanged ? value.map(transaction.changes) : value
    },
    provide: (source) => EditorView.decorations.from(source),
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
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.schedule()
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
