// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import TextEditor from './TextEditor'

afterEach(() => {
  cm6ActiveViewBridge.clear()
  document.body.replaceChildren()
})

describe('TextEditor external content synchronization', () => {
  it('replaces the live CM6 document without reporting an external reload as a user edit', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onChange = vi.fn()

    act(() => {
      root.render(
        <TextEditor content="old text" fileName="notes.txt" readOnly={false} onChange={onChange} />,
      )
    })
    const view = cm6ActiveViewBridge.get()
    expect(view?.state.doc.toString()).toBe('old text')

    act(() => {
      root.render(
        <TextEditor
          content={'\uFEFFnew\r\ntext'}
          fileName="notes.txt"
          readOnly={false}
          onChange={onChange}
        />,
      )
    })
    expect(view?.state.doc.toString()).toBe('new\ntext')
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      view?.dispatch({ changes: { from: view.state.doc.length, insert: '!' } })
    })
    expect(onChange).toHaveBeenLastCalledWith('\uFEFFnew\r\ntext!')

    act(() => root.unmount())
  })
})
