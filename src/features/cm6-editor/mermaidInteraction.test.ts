// @vitest-environment happy-dom

import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { markdownCodeBlockPreview } from './codeBlockPreview'
import {
  MermaidRenderCache,
  markdownMermaidPreview,
  mermaidSourceRange,
  readRenderedMermaidPositions,
  replaceMermaidBlockSource,
} from './mermaidPreview'

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
            // The default cache is module-level and shared across the whole run.
            cache: new MermaidRenderCache(),
          }),
        ],
      }),
    })
    // happy-dom dispatches selectionchange synchronously from focus(), unlike
    // browsers; keep this test scoped to the toggle/decorations contract.
    view.focus = () => undefined
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(view.dom.querySelector('.xmd-cm-mermaid-visual-edit')).not.toBeNull()

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

  it('writes visual edits back into only the Mermaid fence body', () => {
    const source = 'flowchart LR\nA[开始] --> B[结束]'
    const document = `前文\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n后文`
    const from = document.indexOf('```mermaid')
    const to = document.indexOf('```', from + 3) + 3
    view = new EditorView({
      state: EditorState.create({ doc: document }),
    })

    replaceMermaidBlockSource(view, { from, to, source }, 'flowchart TD\nA[开始] --> C[完成]')

    expect(view.state.doc.toString()).toBe(
      '前文\n\n```mermaid\nflowchart TD\nA[开始] --> C[完成]\n```\n\n后文',
    )
  })

  it('does not overwrite a Mermaid block that changed while the visual editor was open', () => {
    const source = 'flowchart LR\nA --> B'
    const document = `\`\`\`mermaid\n${source}\n\`\`\``
    view = new EditorView({ state: EditorState.create({ doc: document }) })
    view.dispatch({
      changes: { from: document.indexOf('B'), to: document.indexOf('B') + 1, insert: 'C' },
    })

    expect(() =>
      replaceMermaidBlockSource(
        view as EditorView,
        { from: 0, to: document.length, source },
        'flowchart LR\nA --> D',
      ),
    ).toThrow('发生了变化')
  })

  it('captures the rendered Mermaid node layout for the visual editor', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <svg>
        <g class="node default" data-id="A" transform="translate(120, 80)"></g>
        <g class="node default" id="mmd-screen-example-flowchart-B-1" transform="translate(360, 220)"></g>
      </svg>
    `
    const [first, second] = Array.from(container.querySelectorAll<SVGGElement>('g.node'))
    first.getBoundingClientRect = () => ({ left: 120, top: 80, width: 100, height: 50 }) as DOMRect
    second.getBoundingClientRect = () =>
      ({ left: 360, top: 220, width: 120, height: 60 }) as DOMRect

    expect(readRenderedMermaidPositions(container)).toEqual({
      A: { x: 80, y: 70 },
      B: { x: 320, y: 210 },
    })
  })
})
