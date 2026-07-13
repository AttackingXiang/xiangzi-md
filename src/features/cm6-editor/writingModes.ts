import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** Keep the primary cursor near the vertical center without owning scroll state. */
export function typewriterScrolling(): Extension {
  return ViewPlugin.fromClass(
    class {
      private frame: number | null = null

      update(update: ViewUpdate): void {
        if ((!update.docChanged && !update.selectionSet) || !update.view.hasFocus) return
        if (this.frame !== null) cancelAnimationFrame(this.frame)
        this.frame = requestAnimationFrame(() => {
          this.frame = null
          const position = update.view.state.selection.main.head
          update.view.dispatch({
            effects: EditorView.scrollIntoView(position, { y: 'center', yMargin: 48 }),
          })
        })
      }

      destroy(): void {
        if (this.frame !== null) cancelAnimationFrame(this.frame)
      }
    },
  )
}
