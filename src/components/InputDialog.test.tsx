// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetModalStack } from '../lib/modalStack'
import InputDialog from './InputDialog'

afterEach(() => {
  document.body.replaceChildren()
  resetModalStack()
})

describe('InputDialog', () => {
  it('keeps the dialog open and disables confirmation for blank input', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<InputDialog title="Rename" onSubmit={onSubmit} onClose={onClose} />))

    const confirm = Array.from(host.querySelectorAll('button')).at(-1)
    expect(confirm?.disabled).toBe(true)
    act(() => confirm?.click())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    act(() => root.unmount())
  })
})
