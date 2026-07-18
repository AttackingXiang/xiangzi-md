import { Annotation, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Marks the selection this module writes, so its own filter lets it through. */
const ownSelection = Annotation.define<boolean>()

/** How long after a secondary click the engine's own selection is refused. */
const guardMs = 250

/**
 * Decide what a secondary click does to the selection, instead of leaving it to
 * the engine.
 *
 * WebKit — the WKWebView this app ships in under Tauri, not the Chromium a
 * `vite dev` browser tab gives you — expands the caret to cover the text under
 * the pointer before it dispatches `contextmenu`. On an empty line that means
 * selecting the line's break, which paints as a full-width strip: the
 * "右键选中一行" report. Chromium does not do this, so none of it reproduces in a
 * plain browser.
 *
 * Two earlier attempts failed, and both failures pin down why this one is
 * shaped the way it is (traced in the WKWebView with `[ctxsel]` logging):
 *
 * 1. `preventDefault()` on `mousedown` (app-level, in `App.tsx`). WebKit's
 *    expansion is not part of the `mousedown` default action — it happens
 *    after that event is dispatched and before `contextmenu` — so there is no
 *    default action to cancel. It "worked" only in Chromium, which *does* put
 *    the caret move in the `mousedown` default action.
 * 2. Dispatching the wanted selection from `contextmenu`. It applies, then
 *    loses: WebKit's expansion is still sitting in the DOM, and CM6's
 *    DOMObserver reads it back on the `selectionchange` that arrives *after*
 *    the handler returns (`onSelectionChange` → `applyDOMChange`, which
 *    dispatches `userEvent: "select"`). Racing an event that has not been
 *    delivered yet cannot be won from inside the handler.
 *
 * So the wanted selection is recorded at `contextmenu` and then *defended*: for
 * a moment afterwards, any DOM-originated selection transaction is rewritten
 * back to it. That is the only seam that sees the sync at all, because the sync
 * is what the filter is filtering.
 *
 * The `mousedown` default action is deliberately left intact: it is what
 * focuses `contentDOM`, and the menu's cut/copy/paste run through
 * `document.execCommand` (`clipboardCmd` in `lib/editorCommands.ts`), which
 * acts on the focused element and silently does nothing without it.
 *
 * Table cells need no exclusion: their widget's `ignoreEvent()` returns true,
 * so `eventBelongsToEditor` rejects these events before the handlers here run,
 * and the cells manage their own selection (`tablePreview.ts`).
 */
export function contextMenuSelection(): Extension {
  let priorSelection: EditorSelection | null = null
  let guard: { until: number; selection: EditorSelection } | null = null

  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        // macOS delivers ctrl+click as a secondary click with `button === 0`.
        // Read the selection now: this runs before WebKit expands it.
        if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
          priorSelection = view.state.selection
        }
        return false
      },
      contextmenu(event, view) {
        // Fall back to the live selection for a context menu opened from the
        // keyboard, which has no preceding mousedown.
        const prior = priorSelection ?? view.state.selection
        priorSelection = null
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        // Hit no line? Then the click landed in `.cm-content`'s padding — half
        // a viewport of it below the document — which is not a request to move
        // the caret, so keep the selection and let the menu act on it.
        // `posAtCoords` cannot answer this: down there it estimates the
        // document's end rather than returning null.
        const target = event.target
        const onLine = target instanceof Element && target.closest('.cm-line') !== null
        // Right-clicking inside a selection keeps it; anywhere else collapses
        // to the pointer. Beyond convention, the menu's formatting commands act
        // on `view.state.selection`, so it has to agree with where the user
        // clicked.
        const keep =
          !onLine ||
          pos === null ||
          prior.ranges.some((range) => !range.empty && pos >= range.from && pos <= range.to)
        const selection = keep ? prior : EditorSelection.single(pos)
        guard = { until: Date.now() + guardMs, selection }
        view.dispatch({
          selection,
          userEvent: 'select.pointer',
          annotations: ownSelection.of(true),
        })
        // The menu itself is opened by the app's own `contextmenu` handler.
        return false
      },
    }),
    EditorState.transactionFilter.of((tr) => {
      if (!guard || tr.annotation(ownSelection)) return tr
      if (Date.now() > guard.until) {
        guard = null
        return tr
      }
      // Only selection-only syncs are suspect. A real edit is never WebKit
      // reasserting a context-menu selection, and must not be rewritten.
      if (tr.docChanged || !tr.selection || !tr.isUserEvent('select')) return tr
      return { selection: guard.selection, annotations: ownSelection.of(true) }
    }),
  ]
}
