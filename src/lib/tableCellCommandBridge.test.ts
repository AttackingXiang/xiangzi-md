import { afterEach, describe, expect, it, vi } from 'vitest'
import { tableCellCommandBridge } from './tableCellCommandBridge'

describe('table-cell command bridge', () => {
  afterEach(() => {
    tableCellCommandBridge.reset()
    vi.unstubAllGlobals()
  })

  it('routes inline commands only to the active table cell and publishes state', () => {
    class NodeStub {}
    vi.stubGlobal('Node', NodeStub)
    const child = new NodeStub()
    const element = Object.assign(new NodeStub(), {
      contains: (target: unknown) => target === child,
    }) as unknown as HTMLElement
    const runInline = vi.fn(() => true)
    const listener = vi.fn()
    const unsubscribe = tableCellCommandBridge.subscribe(listener)

    tableCellCommandBridge.activate({
      element,
      runInline,
      readState: () => ({
        hasSelection: true,
        bold: true,
        italic: false,
        strike: false,
        inlineCode: false,
      }),
      selectAll: vi.fn(),
    })

    expect(tableCellCommandBridge.ownsTarget(child as unknown as EventTarget)).toBe(true)
    expect(tableCellCommandBridge.runInline('bold')).toBe(true)
    expect(runInline).toHaveBeenCalledWith('bold')
    expect(tableCellCommandBridge.getState()).toMatchObject({ focused: true, bold: true })

    tableCellCommandBridge.deactivate(element)
    expect(tableCellCommandBridge.isFocused()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ focused: false }))
    unsubscribe()
  })
})
