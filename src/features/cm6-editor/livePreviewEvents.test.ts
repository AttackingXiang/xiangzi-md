import { describe, expect, it } from 'vitest'
import { shouldOpenMarkdownLink } from './livePreviewEvents'

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
