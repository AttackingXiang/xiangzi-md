import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  MermaidRenderCache,
  MermaidWidget,
  buildMermaidPreviewDecorations,
  mermaidSourceRange,
  setMermaidSourceRange,
} from './mermaidPreview'
import { createExternalSyncTransaction } from './sync'

const mermaidStyles = readFileSync(new URL('./mermaidPreview.css', import.meta.url), 'utf8')

describe('CM6 Mermaid preview boundary', () => {
  it('clears source-mode UI when the editor is externally switched to another document', () => {
    let state = EditorState.create({
      doc: '```mermaid\ngraph TD\n```',
      extensions: [markdown(), mermaidSourceRange],
    })
    state = state.update({
      effects: setMermaidSourceRange.of({ from: 0, to: state.doc.length }),
    }).state
    const replacement = createExternalSyncTransaction(state, '# Another document')
    expect(replacement).not.toBeNull()
    state = state.update(replacement!).state

    expect(state.field(mermaidSourceRange)).toBeNull()
  })

  it('keeps pointer interaction inside the preview', () => {
    const copyRenderer = () => Promise.resolve('<svg viewBox="0 0 10 10"><path /></svg>')
    const widget = new MermaidWidget(
      { from: 0, to: 30, source: 'graph TD' },
      () => Promise.resolve('<svg viewBox="0 0 10 10"><path /></svg>'),
      new MermaidRenderCache(),
      'test',
      'Diagram error',
      copyRenderer,
    )
    expect(widget.ignoreEvent()).toBe(true)
    expect(widget.estimatedHeight).toBe(112)
    expect(
      widget.eq(
        new MermaidWidget(
          { from: 0, to: 30, source: 'graph TD' },
          widget.renderer,
          widget.cache,
          'test',
          'Diagram error',
          copyRenderer,
        ),
      ),
    ).toBe(true)
    expect(
      widget.eq(
        new MermaidWidget(
          { from: 0, to: 30, source: 'graph TD' },
          widget.renderer,
          widget.cache,
          'test',
          'Diagram error',
          () => Promise.resolve('<svg />'),
        ),
      ),
    ).toBe(false)
  })

  it('uses a measured auto-height block instead of fixed or overflowing geometry', () => {
    expect(mermaidStyles).toMatch(/\.xmd-cm-mermaid-block\s*\{[^}]*padding:/s)
    expect(mermaidStyles).toMatch(/\.xmd-cm-mermaid-preview\s*\{[^}]*margin:\s*0;/s)
    expect(mermaidStyles).not.toMatch(/\.xmd-cm-mermaid-preview\s*\{[^}]*min-height:\s*220px;/s)
    expect(mermaidStyles).toMatch(
      /\.xmd-cm-mermaid-content svg\s*\{[^}]*height:\s*auto;[^}]*max-width:\s*100%;[^}]*width:\s*100%;/s,
    )
    expect(mermaidStyles).not.toMatch(/\.xmd-cm-mermaid-content svg\s*\{[^}]*max-height:/s)
  })

  it('keeps preview mounted while a non-empty selection crosses the block', () => {
    const doc = 'before\n```mermaid\ngraph TD\n```\nafter'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown()],
    })
    const set = buildMermaidPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      render: () => Promise.resolve('<svg />'),
      viewportMargin: 0,
    })
    let count = 0
    set.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(1)
  })

  it('only decorates visible Mermaid fences', () => {
    const first = '```mermaid\ngraph TD\n```'
    const doc = `${first}${'\nplain'.repeat(80)}\n\`\`\`mermaid\ngraph LR\n\`\`\``
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(first.length + 2),
      extensions: [markdown()],
    })
    const set = buildMermaidPreviewDecorations(state, [{ from: 0, to: first.length }], {
      render: () => Promise.resolve('<svg />'),
      viewportMargin: 0,
    })
    let count = 0
    set.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(1)
  })

  it('decorates consecutive and structurally different Mermaid diagrams independently', () => {
    const diagrams = [
      '```mermaid\nflowchart LR\nA --> B\n```',
      '```mermaid\nsequenceDiagram\nA->>B: hello\n```',
      '```mermaid\nstateDiagram-v2\n[*] --> Ready\nReady --> [*]\n```',
    ]
    const doc = diagrams.join('\n')
    const state = EditorState.create({ doc, extensions: [markdown()] })
    const set = buildMermaidPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      render: () => Promise.resolve('<svg />'),
      viewportMargin: 0,
    })
    let count = 0
    set.between(0, doc.length, () => {
      count += 1
    })
    expect(count).toBe(diagrams.length)
  })

  it.each([
    {
      name: 'blockquote',
      doc: '> ```mermaid\n> flowchart TD\n> A --> B\n> B --> C\n> ```',
    },
    {
      name: 'list item',
      doc: '- diagram\n\n  ```mermaid title="nested"\n  flowchart TD\n  A --> B\n  B --> C\n  ```',
    },
  ])('preserves every source line for a Mermaid fence in a $name', ({ doc }) => {
    const state = EditorState.create({ doc, extensions: [markdown()] })
    const set = buildMermaidPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      render: () => Promise.resolve('<svg />'),
      viewportMargin: 0,
    })
    let widget: MermaidWidget | undefined
    set.between(0, doc.length, (_from, _to, decoration) => {
      const candidate = (decoration.spec as unknown as { widget?: unknown }).widget
      if (candidate instanceof MermaidWidget) widget = candidate
    })
    expect(widget?.block.source).toBe('flowchart TD\nA --> B\nB --> C')
  })

  it('keeps the full body of a large Mermaid fence', () => {
    const source = [
      'flowchart TD',
      ...Array.from({ length: 600 }, (_, i) => `N${i} --> N${i + 1}`),
    ].join('\n')
    const doc = `~~~mermaid\n${source}\n~~~`
    const state = EditorState.create({ doc, extensions: [markdown()] })
    const set = buildMermaidPreviewDecorations(state, [{ from: 0, to: doc.length }], {
      render: () => Promise.resolve('<svg />'),
      viewportMargin: 0,
    })
    let widget: MermaidWidget | undefined
    set.between(0, doc.length, (_from, _to, decoration) => {
      const candidate = (decoration.spec as unknown as { widget?: unknown }).widget
      if (candidate instanceof MermaidWidget) widget = candidate
    })
    expect(widget?.block.source).toBe(source)
  })

  it('deduplicates renders and keys cache by renderer version', async () => {
    const renderer = vi.fn(() => Promise.resolve('<svg />'))
    const cache = new MermaidRenderCache(4)
    const first = cache.render('graph TD', 'light', renderer)
    const duplicate = cache.render('graph TD', 'light', renderer)
    await Promise.all([first, duplicate])
    await cache.render('graph TD', 'dark', renderer)

    expect(renderer).toHaveBeenCalledTimes(2)
  })

  it('does not cache renderer failures', async () => {
    const renderer = vi.fn(() => Promise.reject(new Error('bad graph')))
    const cache = new MermaidRenderCache()
    await expect(cache.render('bad', 'v1', renderer)).rejects.toThrow('bad graph')
    await expect(cache.render('bad', 'v1', renderer)).rejects.toThrow('bad graph')
    expect(renderer).toHaveBeenCalledTimes(2)
  })
})
