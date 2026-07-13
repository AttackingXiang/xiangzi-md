import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { markdownCodeBlockPreview } from './codeBlockPreview'
import { markdownMathPreview } from './mathPreview'
import { markdownMermaidPreview } from './mermaidPreview'

describe('vertically significant preview extensions', () => {
  it.each([
    ['fenced code', markdownCodeBlockPreview()],
    ['display math', markdownMathPreview()],
    ['Mermaid', markdownMermaidPreview({ render: () => Promise.resolve('<svg />') })],
  ])('provides %s decorations through a StateField', (_name, extension) => {
    const state = EditorState.create({ doc: '', extensions: [markdown(), extension] })
    // StateField-provided decorations are registered directly in this facet.
    // A ViewPlugin decorations provider would fail for cross-line replacements.
    expect(state.facet(EditorView.decorations).length).toBeGreaterThan(0)
  })
})
