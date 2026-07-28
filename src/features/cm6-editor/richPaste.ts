import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdownFromClipboardHtml } from '../../lib/markdownPaste'

/** Preserve rich clipboard structure by inserting Markdown instead of rendered plain text. */
export function richMarkdownPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false
      const clipboard = event.clipboardData
      if (!clipboard || clipboard.files.length > 0) return false
      const html = clipboard.getData('text/html')
      if (!html) return false
      const markdown = markdownFromClipboardHtml(html)
      if (markdown === null) return false

      event.preventDefault()
      view.dispatch(view.state.replaceSelection(markdown), {
        userEvent: 'input.paste',
        scrollIntoView: true,
      })
      return true
    },
  })
}
