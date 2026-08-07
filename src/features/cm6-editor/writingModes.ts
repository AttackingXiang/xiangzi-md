import type { Extension } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  type EditorView as EditorViewInstance,
  type ViewUpdate,
} from '@codemirror/view'
import {
  isPointerSelectionActive,
  selectionCoordinatorObserver,
} from './selection/selectionCoordinator'

/** Keep the primary cursor near the vertical center without owning scroll state. */
class TypewriterScrollingPlugin {
  private frame: number | null = null

  constructor(readonly view: EditorViewInstance) {}

  update(update: ViewUpdate): void {
    if ((!update.docChanged && !update.selectionSet) || !update.view.hasFocus) return
    this.scheduleIfAllowed(update.view)
  }

  onPointerSelectionEnd(view: EditorViewInstance, canceled: boolean): void {
    if (canceled) return
    this.scheduleIfAllowed(view)
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  }

  private scheduleIfAllowed(view: EditorViewInstance): void {
    if (
      !view.hasFocus ||
      isPointerSelectionActive(view.state) ||
      !view.state.selection.main.empty
    ) {
      if (this.frame !== null) cancelAnimationFrame(this.frame)
      this.frame = null
      return
    }

    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (
        !view.hasFocus ||
        isPointerSelectionActive(view.state) ||
        !view.state.selection.main.empty
      ) {
        return
      }
      const position = view.state.selection.main.head
      view.dispatch({
        effects: EditorView.scrollIntoView(position, { y: 'center', yMargin: 48 }),
      })
    })
  }
}

const typewriterPlugin = ViewPlugin.fromClass(TypewriterScrollingPlugin)

export function typewriterScrolling(): Extension {
  return [
    typewriterPlugin,
    selectionCoordinatorObserver.of({
      onPointerSelectionEnd(view, canceled) {
        view.plugin(typewriterPlugin)?.onPointerSelectionEnd(view, canceled)
      },
    }),
  ]
}
