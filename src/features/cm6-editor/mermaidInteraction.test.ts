// @vitest-environment happy-dom

import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { markdownCodeBlockPreview } from './codeBlockPreview'
import { markdownMermaidPreview, mermaidSourceRange } from './mermaidPreview'

describe('Mermaid preview controls', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('returns from source mode to the rendered preview through the eye button', async () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: '```mermaid\nflowchart LR\nA --> B\n```',
        extensions: [
          markdown(),
          markdownCodeBlockPreview(),
          markdownMermaidPreview({
            render: () => Promise.resolve('<svg viewBox="0 0 20 10" />'),
          }),
        ],
      }),
    })
    // happy-dom dispatches selectionchange synchronously from focus(), unlike
    // browsers; keep this test scoped to the toggle/decorations contract.
    view.focus = () => undefined
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    view.dom.querySelector<HTMLButtonElement>('.xmd-cm-mermaid-source-toggle')?.click()
    expect(view.state.field(mermaidSourceRange)).not.toBeNull()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    const sourceLine = view.dom.querySelector<HTMLElement>('.cm-line.xmd-cm-code-line')
    expect(sourceLine).not.toBeNull()
    expect(sourceLine?.textContent).toContain('flowchart LR')
    const previewToggle = view.dom.querySelector<HTMLButtonElement>(
      '.xmd-cm-code-preview-header .xmd-cm-mermaid-preview-toggle',
    )
    expect(previewToggle).not.toBeNull()
    expect(previewToggle?.hidden).toBe(false)

    previewToggle?.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(view.state.field(mermaidSourceRange)).toBeNull()
    expect(view.dom.querySelector('.xmd-cm-mermaid-preview')).not.toBeNull()
  })
})
