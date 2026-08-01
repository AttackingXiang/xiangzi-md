import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkPromptBridge } from './linkPromptBridge'

describe('linkPromptBridge', () => {
  afterEach(() => {
    linkPromptBridge.reset()
  })

  it('forwards the initial value and submit callback to the handler', () => {
    const handler = vi.fn()
    linkPromptBridge.setHandler(handler)

    const onSubmit = vi.fn()
    linkPromptBridge.request('https://example.com', onSubmit)

    expect(handler).toHaveBeenCalledWith('https://example.com', onSubmit)
  })

  it('does nothing when requested with no handler registered', () => {
    expect(() => linkPromptBridge.request('', vi.fn())).not.toThrow()
  })
})
