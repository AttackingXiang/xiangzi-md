import { afterEach, describe, expect, it, vi } from 'vitest'
import { tableZoomBridge } from './tableZoomBridge'

describe('tableZoomBridge', () => {
  afterEach(() => {
    tableZoomBridge.reset()
  })

  it('forwards the rendered table snapshot to the registered handler', () => {
    const handler = vi.fn()
    tableZoomBridge.setHandler(handler)

    tableZoomBridge.request('<table></table>')

    expect(handler).toHaveBeenCalledWith('<table></table>')
  })

  it('does nothing when requested with no handler registered', () => {
    expect(() => tableZoomBridge.request('<table></table>')).not.toThrow()
  })
})
