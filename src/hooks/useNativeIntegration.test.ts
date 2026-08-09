// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { popModal, pushModal, resetModalStack } from '../lib/modalStack'
import { shouldHandleNativeMenuAction } from './useNativeIntegration'

afterEach(resetModalStack)

describe('native menu modal scope', () => {
  it('blocks background application actions but preserves the OS quit handshake', () => {
    const modal = document.createElement('div')
    pushModal(modal)

    expect(shouldHandleNativeMenuAction('new-file')).toBe(false)
    expect(shouldHandleNativeMenuAction('export-pdf')).toBe(false)
    expect(shouldHandleNativeMenuAction('query-dirty')).toBe(true)

    popModal(modal)
    expect(shouldHandleNativeMenuAction('new-file')).toBe(true)
  })
})
