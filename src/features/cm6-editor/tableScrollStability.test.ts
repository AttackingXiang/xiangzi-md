// @vitest-environment happy-dom

import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { hiddenRangeSource } from './core/hiddenRanges'
import { markdownTablePreview } from './tablePreview'

const tableSource = [
  '| ID | Description |',
  '| --- | --- |',
  ...Array.from(
    { length: 30 },
    (_, index) => `| ${index} | ${'long wrapped content '.repeat(20)} |`,
  ),
].join('\n')

const source = 'Before\n\n' + tableSource + '\n\nAfter'

const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0))

describe('long table viewport stability', () => {
  it('keeps a table mounted when its replacement fills the viewport and no source text is visible', async () => {
    const readOnly = new Compartment()
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdown({ extensions: GFM }),
          markdownTablePreview(),
          readOnly.of(EditorState.readOnly.of(false)),
        ],
      }),
    })
    try {
      await settle()
      expect(view.dom.querySelector('.xmd-cm-table-preview')).not.toBeNull()
      // CM6 excludes replacement ranges from visibleRanges. A tall block can
      // fill the entire viewport, leaving no visible source spans at all.
      Object.defineProperty(view, 'visibleRanges', { configurable: true, get: () => [] })
      Object.defineProperty(view, 'viewport', {
        configurable: true,
        get: () => ({ from: 0, to: source.length }),
      })
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(true)) })
      await settle()
      expect(view.dom.querySelector('.xmd-cm-table-preview')).not.toBeNull()
      const ranges = view.state.facet(hiddenRangeSource).flatMap((build) =>
        build({
          state: view.state,
          visibleRanges: [],
          revealed: { ranges: [] },
        }),
      )
      expect(ranges).toContainEqual({
        from: 8,
        to: 8 + tableSource.length,
        presentation: 'external',
      })
    } finally {
      view.destroy()
    }
  })
})
