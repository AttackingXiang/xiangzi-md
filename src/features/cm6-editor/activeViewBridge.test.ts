import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { cm6ActiveViewBridge } from './activeViewBridge'

const fakeView = (): EditorView => ({}) as EditorView

describe('CM6 active view bridge', () => {
  afterEach(() => cm6ActiveViewBridge.clear())

  it('does not let a stale owner unregister the newer view', () => {
    const first = fakeView()
    const second = fakeView()
    const unregisterFirst = cm6ActiveViewBridge.register(first)
    cm6ActiveViewBridge.register(second)

    unregisterFirst()

    expect(cm6ActiveViewBridge.get()).toBe(second)
  })

  it('unregisters the current owner', () => {
    const unregister = cm6ActiveViewBridge.register(fakeView())
    unregister()
    expect(cm6ActiveViewBridge.get()).toBeNull()
  })

  it('clears a view that was reactivated after another editor', () => {
    const first = fakeView()
    const unregisterFirst = cm6ActiveViewBridge.register(first)
    cm6ActiveViewBridge.register(fakeView())
    cm6ActiveViewBridge.activate(first)

    unregisterFirst()

    expect(cm6ActiveViewBridge.get()).toBeNull()
  })
})
