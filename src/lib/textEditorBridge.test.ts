import { afterEach, describe, expect, it, vi } from 'vitest'
import { textEditorBridge } from './textEditorBridge'

describe('textEditorBridge', () => {
  afterEach(() => {
    textEditorBridge.reset()
  })

  it('opens the search panel of the currently mounted TextEditor', () => {
    const openSearch = vi.fn()
    textEditorBridge.set(openSearch)

    textEditorBridge.openSearch()

    expect(openSearch).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no mounted TextEditor', () => {
    expect(() => textEditorBridge.openSearch()).not.toThrow()
  })

  it('unregisters the callback when the TextEditor unmounts', () => {
    const openSearch = vi.fn()
    textEditorBridge.set(openSearch)
    textEditorBridge.set(null)

    textEditorBridge.openSearch()

    expect(openSearch).not.toHaveBeenCalled()
  })
})
