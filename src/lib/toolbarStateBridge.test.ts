import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TOOLBAR_ACTIVE_STATE,
  toolbarStateBridge,
  type ToolbarActiveState,
} from './toolbarStateBridge'

const boldState: ToolbarActiveState = { ...DEFAULT_TOOLBAR_ACTIVE_STATE, bold: true }

describe('toolbarStateBridge', () => {
  afterEach(() => {
    toolbarStateBridge.setListener(null)
    toolbarStateBridge.reset()
  })

  it('replays the last known state immediately to a newly registered listener', () => {
    toolbarStateBridge.notify(boldState)

    const listener = vi.fn()
    toolbarStateBridge.setListener(listener)

    expect(listener).toHaveBeenCalledWith(boldState)
  })

  it('notifies the registered listener on every notify() call', () => {
    const listener = vi.fn()
    toolbarStateBridge.setListener(listener)
    listener.mockClear()

    toolbarStateBridge.notify(boldState)

    expect(listener).toHaveBeenCalledWith(boldState)
  })

  it('replaces rather than stacks the listener on repeated setListener calls', () => {
    const first = vi.fn()
    const second = vi.fn()
    toolbarStateBridge.setListener(first)
    toolbarStateBridge.setListener(second)
    first.mockClear()
    second.mockClear()

    toolbarStateBridge.notify(boldState)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(boldState)
  })

  it('stops notifying once the listener is cleared with null', () => {
    const listener = vi.fn()
    toolbarStateBridge.setListener(listener)
    toolbarStateBridge.setListener(null)
    listener.mockClear()

    toolbarStateBridge.notify(boldState)

    expect(listener).not.toHaveBeenCalled()
  })

  it('reset() restores the default state and notifies the current listener', () => {
    const listener = vi.fn()
    toolbarStateBridge.notify(boldState)
    toolbarStateBridge.setListener(listener)
    listener.mockClear()

    toolbarStateBridge.reset()

    expect(listener).toHaveBeenCalledWith(DEFAULT_TOOLBAR_ACTIVE_STATE)

    const late = vi.fn()
    toolbarStateBridge.setListener(late)
    expect(late).toHaveBeenCalledWith(DEFAULT_TOOLBAR_ACTIVE_STATE)
  })
})
