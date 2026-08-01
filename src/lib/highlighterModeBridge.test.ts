import { afterEach, describe, expect, it, vi } from 'vitest'
import { highlighterModeBridge } from './highlighterModeBridge'

describe('highlighterModeBridge', () => {
  afterEach(() => {
    highlighterModeBridge.selectColor('#fde047', false)
    highlighterModeBridge.deactivate()
  })

  it('remembers the selected color after the tool is deactivated', () => {
    highlighterModeBridge.selectColor('#93c5fd')
    expect(highlighterModeBridge.getState()).toEqual({ active: true, color: '#93c5fd' })

    highlighterModeBridge.deactivate()
    expect(highlighterModeBridge.getState()).toEqual({ active: false, color: '#93c5fd' })

    highlighterModeBridge.activate()
    expect(highlighterModeBridge.getState()).toEqual({ active: true, color: '#93c5fd' })
  })

  it('publishes both activation and color changes', () => {
    const listener = vi.fn()
    const unsubscribe = highlighterModeBridge.subscribe(listener)

    highlighterModeBridge.activate()
    highlighterModeBridge.selectColor('#6ee7b7')
    highlighterModeBridge.deactivate()

    expect(listener).toHaveBeenLastCalledWith({ active: false, color: '#6ee7b7' })
    unsubscribe()
  })

  it('remembers a selected color without leaving pointer mode active', () => {
    highlighterModeBridge.selectColor('#fde047')
    highlighterModeBridge.selectColor('#fda4af', false)
    expect(highlighterModeBridge.getState()).toEqual({ active: false, color: '#fda4af' })
  })

  it('toggle() flips activation without touching the color', () => {
    highlighterModeBridge.selectColor('#93c5fd', false)

    highlighterModeBridge.toggle()
    expect(highlighterModeBridge.getState()).toEqual({ active: true, color: '#93c5fd' })

    highlighterModeBridge.toggle()
    expect(highlighterModeBridge.getState()).toEqual({ active: false, color: '#93c5fd' })
  })

  it('syncDefaultColor() only follows the settings default until the user picks their own color', () => {
    highlighterModeBridge.syncDefaultColor('#fde047')
    expect(highlighterModeBridge.getState().color).toBe('#fde047')

    // Settings default changes and the user hasn't picked a color yet: follow it.
    highlighterModeBridge.syncDefaultColor('#93c5fd')
    expect(highlighterModeBridge.getState().color).toBe('#93c5fd')

    // User actively picks a color: further default syncs must not clobber it.
    highlighterModeBridge.selectColor('#fda4af', false)
    highlighterModeBridge.syncDefaultColor('#6ee7b7')
    expect(highlighterModeBridge.getState().color).toBe('#fda4af')
  })

  it('reset() drops subscribers and restores the initial state', () => {
    highlighterModeBridge.selectColor('#93c5fd')
    const listener = vi.fn()
    highlighterModeBridge.subscribe(listener)
    listener.mockClear()

    highlighterModeBridge.reset()

    expect(highlighterModeBridge.getState()).toEqual({ active: false, color: '#fde047' })
    highlighterModeBridge.activate()
    expect(listener).not.toHaveBeenCalled()
  })
})
