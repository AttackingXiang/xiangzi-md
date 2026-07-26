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
})
