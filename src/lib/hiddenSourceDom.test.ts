import { describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_SOURCE_ATTRIBUTE,
  HIDDEN_SOURCE_SELECTOR,
  removeHiddenSource,
} from './hiddenSourceDom'

describe('hidden source DOM cleanup', () => {
  it('uses one shared marker contract for editor, export, and clipboard code', () => {
    expect(HIDDEN_SOURCE_ATTRIBUTE).toBe('data-xmd-hidden-source')
    expect(HIDDEN_SOURCE_SELECTOR).toBe('[data-xmd-hidden-source]')
  })

  it('removes every source-preserving marker from a cloned DOM root', () => {
    const removeFirst = vi.fn()
    const removeSecond = vi.fn()
    const querySelectorAll = vi.fn(() => [{ remove: removeFirst }, { remove: removeSecond }])

    removeHiddenSource({ querySelectorAll } as unknown as ParentNode)

    expect(querySelectorAll).toHaveBeenCalledWith(HIDDEN_SOURCE_SELECTOR)
    expect(removeFirst).toHaveBeenCalledOnce()
    expect(removeSecond).toHaveBeenCalledOnce()
  })
})
