import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { MermaidRenderCache, MermaidWidget, buildMermaidPreviewDecorations } from './mermaidPreview'

describe('CM6 Mermaid preview boundary', () => {
  it('keeps pointer interaction inside the preview', () => {
    const widget = new MermaidWidget(
      { from: 0, to: 30, source: 'graph TD' },
      () => Promise.resolve('<svg viewBox="0 0 10 10"><path /></svg>'),
      new MermaidRenderCache(),
      'test',
      'Diagram error',
      () => Promise.resolve('<svg viewBox="0 0 10 10"><path /></svg>'),
    )
    expect(widget.ignoreEvent()).toBe(true)
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
