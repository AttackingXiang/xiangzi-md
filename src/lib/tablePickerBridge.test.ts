import { afterEach, describe, expect, it, vi } from 'vitest'
import { tablePickerBridge } from './tablePickerBridge'

describe('tablePickerBridge', () => {
  afterEach(() => {
    tablePickerBridge.reset()
  })

  it('forwards the request coordinates and insert callback to the handler', () => {
    const handler = vi.fn()
    tablePickerBridge.setHandler(handler)

    const onInsert = vi.fn()
    tablePickerBridge.request(12, 34, onInsert)

    expect(handler).toHaveBeenCalledWith(12, 34, onInsert)
  })

  it('does nothing when requested with no handler registered', () => {
    expect(() => tablePickerBridge.request(0, 0, vi.fn())).not.toThrow()
  })

  it('stops forwarding once the handler is unregistered', () => {
    const handler = vi.fn()
    tablePickerBridge.setHandler(handler)
    tablePickerBridge.setHandler(null)

    tablePickerBridge.request(1, 2, vi.fn())

    expect(handler).not.toHaveBeenCalled()
  })
})
