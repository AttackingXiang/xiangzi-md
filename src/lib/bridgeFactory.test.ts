import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestBridge, createStateBridge } from './bridgeFactory'

describe('createRequestBridge', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('forwards requests to the registered handler', () => {
    const bridge = createRequestBridge<[a: number, b: string]>('test-bridge')
    const handler = vi.fn()
    bridge.setHandler(handler)

    bridge.request(1, 'go')

    expect(handler).toHaveBeenCalledWith(1, 'go')
  })

  it('replaces the previous handler rather than stacking handlers', () => {
    const bridge = createRequestBridge<[value: number]>('test-bridge')
    const first = vi.fn()
    const second = vi.fn()
    bridge.setHandler(first)
    bridge.setHandler(second)

    bridge.request(1)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(1)
  })

  it('drops the request silently when no handler is registered', () => {
    const bridge = createRequestBridge<[value: number]>('test-bridge')

    expect(() => bridge.request(1)).not.toThrow()
  })

  it('warns in dev mode when a request has no handler', () => {
    vi.stubEnv('DEV', true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bridge = createRequestBridge<[value: number]>('picker-bridge')

    bridge.request(1)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('picker-bridge')
  })

  it('stays silent in production builds even with no handler', () => {
    vi.stubEnv('DEV', false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bridge = createRequestBridge<[value: number]>('picker-bridge')

    bridge.request(1)

    expect(warn).not.toHaveBeenCalled()
  })

  it('reset() clears the handler so a later request warns again', () => {
    vi.stubEnv('DEV', true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bridge = createRequestBridge<[value: number]>('picker-bridge')
    const handler = vi.fn()
    bridge.setHandler(handler)

    bridge.reset()
    bridge.request(1)

    expect(handler).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('createStateBridge', () => {
  it('starts subscribers off with the current state immediately', () => {
    const bridge = createStateBridge({ count: 0 })
    const listener = vi.fn()

    bridge.subscribe(listener)

    expect(listener).toHaveBeenCalledWith({ count: 0 })
  })

  it('notifies subscribers on every setState by default', () => {
    const bridge = createStateBridge({ count: 0 })
    const listener = vi.fn()
    bridge.subscribe(listener)
    listener.mockClear()

    bridge.setState({ count: 0 })
    bridge.setState({ count: 1 })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(bridge.getState()).toEqual({ count: 1 })
  })

  it('skips notification when isEqual reports no change', () => {
    const bridge = createStateBridge({ count: 0 }, { isEqual: (a, b) => a.count === b.count })
    const listener = vi.fn()
    bridge.subscribe(listener)
    listener.mockClear()

    bridge.setState({ count: 0 })
    expect(listener).not.toHaveBeenCalled()

    bridge.setState({ count: 1 })
    expect(listener).toHaveBeenCalledWith({ count: 1 })
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const bridge = createStateBridge({ count: 0 })
    const listener = vi.fn()
    const unsubscribe = bridge.subscribe(listener)
    listener.mockClear()

    unsubscribe()
    bridge.setState({ count: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('lets a listener unsubscribe mid-notification without skipping a sibling', () => {
    const bridge = createStateBridge({ count: 0 })
    const calls: string[] = []
    let unsubscribeA: () => void = () => undefined
    const listenerA = (): void => {
      calls.push('a')
      unsubscribeA()
    }
    const listenerB = (): void => {
      calls.push('b')
    }
    unsubscribeA = bridge.subscribe(listenerA)
    bridge.subscribe(listenerB)
    calls.length = 0

    bridge.setState({ count: 1 })

    expect(calls).toEqual(['a', 'b'])
  })

  it('reset() drops subscribers and restores the initial value', () => {
    const bridge = createStateBridge({ count: 0 })
    bridge.setState({ count: 5 })
    const listener = vi.fn()
    bridge.subscribe(listener)
    listener.mockClear()

    bridge.reset()

    expect(bridge.getState()).toEqual({ count: 0 })
    bridge.setState({ count: 9 })
    expect(listener).not.toHaveBeenCalled()
  })
})
