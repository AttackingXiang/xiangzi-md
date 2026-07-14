import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { linePositionAtPointer } from './livePreviewPointer'
import { safeMarkdownLinkHref } from './markdownLinks'

function linkAtEvent(event: Event, view: EditorView): HTMLElement | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const link = target.closest<HTMLElement>('[data-xmd-href]')
  return link && view.dom.contains(link) ? link : null
}

function dispatchLink(link: HTMLElement, view: EditorView): void {
  const href = safeMarkdownLinkHref(link.dataset.xmdHref ?? '')
  if (!href) return
  view.dom.dispatchEvent(new CustomEvent('xmd-link-open', { bubbles: true, detail: { href } }))
}

interface LinkActivationGesture {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function shouldOpenMarkdownLink(event: LinkActivationGesture, editing: boolean): boolean {
  if (event.button !== 0 || event.shiftKey || event.altKey) return false
  // Cmd/Ctrl-click is retained for users accustomed to source editors. In
  // rendered live preview, a plain click follows the link; when its Markdown
  // source is already revealed, a plain click continues to position the caret.
  return event.metaKey || event.ctrlKey || !editing
}

function shouldOpenLink(event: MouseEvent, link: HTMLElement): boolean {
  return shouldOpenMarkdownLink(event, link.dataset.xmdEditing === 'true')
}

/**
 * Pointer/keyboard interactions that don't fit the CM6 keymap: plain-click on
 * a rendered link, Cmd/Ctrl-click, and Enter-on-focus open it via the
 * `xmd-link-open` DOM event; a
 * click-to-position fix for genuinely empty lines, and the heading-specific
 * click-position compensation needed because a heading's hidden `#` prefix
 * must never capture a click (see `livePreviewPointer.ts`).
 */
export function livePreviewEventHandlers(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const link = linkAtEvent(event, view)
      if (!link || !shouldOpenLink(event, link)) return false
      // Prevent CodeMirror moving the caret into the link between mousedown
      // and click. That would reveal its source and turn the same gesture into
      // an edit action before the click handler gets to dispatch navigation.
      event.preventDefault()
      return true
    },
    pointerdown(event, view) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return false
      const target = event.target
      if (target instanceof Element) {
        const emptyLine = target.closest<HTMLElement>('.cm-line')
        // Fenced code owns the redirect for its own collapsed fence lines
        // (see codeBlockPreview.ts) — clicking that area must land inside
        // the block's first/last code row, not at the raw hidden position.
        if (
          emptyLine?.parentElement === view.contentDOM &&
          !emptyLine.classList.contains('xmd-cm-code-fence-line') &&
          (emptyLine.textContent ?? '').trim() === ''
        ) {
          const anchor = view.posAtDOM(emptyLine, 0)
          event.preventDefault()
          view.dispatch({ selection: { anchor }, scrollIntoView: true })
          view.focus()
          return true
        }
      }
      return false
    },
    click(event, view) {
      if (event.button !== 0) return false
      const link = linkAtEvent(event, view)
      if (link && shouldOpenLink(event, link)) {
        event.preventDefault()
        dispatchLink(link, view)
        return true
      }
      if (event.shiftKey || event.altKey || !view.state.selection.main.empty) return false
      const target = event.target
      if (!(target instanceof Element)) return false
      if (target.closest('button, input, select, textarea, [role="checkbox"]')) return false
      const line = target.closest<HTMLElement>('.cm-line')
      if (!line || line.parentElement !== view.contentDOM || line.textContent === '') return false
      // Fenced code is ordinary outer-CM6 content now. Native hit testing is
      // exact there; applying the legacy block-widget correction a second
      // time causes the caret to visibly jump before settling.
      if (line.classList.contains('xmd-cm-code-line')) return false
      // Native CM6 hit-testing is more accurate for ordinary paragraphs and
      // inline marks. Only headings need source-marker compensation.
      if (!line.classList.contains('xmd-cm-heading')) return false
      const anchor = linePositionAtPointer(event, view, line)
      if (view.state.selection.main.head === anchor) return false
      event.preventDefault()
      view.dispatch({ selection: { anchor }, scrollIntoView: true })
      view.focus()
      return true
    },
    keydown(event, view) {
      if (event.key !== 'Enter') return false
      const link = linkAtEvent(event, view)
      if (!link) return false
      event.preventDefault()
      dispatchLink(link, view)
      return true
    },
  })
}
