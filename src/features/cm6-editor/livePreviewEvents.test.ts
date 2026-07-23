// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { livePreviewEventHandlers, shouldOpenMarkdownLink } from './livePreviewEvents'

const plainClick = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

describe('live preview link activation', () => {
  it('opens rendered links with one plain click', () => {
    expect(shouldOpenMarkdownLink(plainClick, false)).toBe(true)
  })

  it('keeps a revealed Markdown link editable with a plain click', () => {
    expect(shouldOpenMarkdownLink(plainClick, true)).toBe(false)
  })

  it('retains Cmd/Ctrl-click navigation while leaving modified selection gestures alone', () => {
    expect(shouldOpenMarkdownLink({ ...plainClick, metaKey: true }, true)).toBe(true)
    expect(shouldOpenMarkdownLink({ ...plainClick, ctrlKey: true }, true)).toBe(true)
    expect(shouldOpenMarkdownLink({ ...plainClick, shiftKey: true }, false)).toBe(false)
    expect(shouldOpenMarkdownLink({ ...plainClick, button: 1 }, false)).toBe(false)
  })
})

describe('live preview empty-line pointer handling', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    document.body.replaceChildren()
  })

  function createView(): { emptyLine: HTMLElement; emptyLineFrom: number } {
    const parent = document.createElement('div')
    document.body.append(parent)
    const doc = 'before\n\nafter'
    const emptyLineFrom = doc.indexOf('\n') + 1
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [livePreviewEventHandlers()],
      }),
    })
    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')]
    const emptyLine = lines.find((line) => line.textContent === '')
    if (!emptyLine) throw new Error('expected an empty editor line')
    return { emptyLine, emptyLineFrom }
  }

  it('does not cancel pointerdown, preserving a drag that starts on the empty line', () => {
    const { emptyLine } = createView()
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })

    emptyLine.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('still corrects a completed click on the empty line', () => {
    const { emptyLine, emptyLineFrom } = createView()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })

    emptyLine.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view?.state.selection.main.head).toBe(emptyLineFrom)
  })
})
