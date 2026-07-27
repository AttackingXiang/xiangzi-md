import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const contract = read('../styles/slices/theme-contract.css')

const consumers = [
  read('../features/cm6-editor/editor.css'),
  read('../features/cm6-editor/livePreview.css'),
  read('../features/cm6-editor/codeBlockPreview.css'),
  read('../features/cm6-editor/tablePreview.css'),
  read('../features/cm6-editor/imagePreview.css'),
  read('../features/cm6-editor/mathPreview.css'),
  read('../features/cm6-editor/mermaidPreview.css'),
  read('./codeTheme.ts'),
  read('./mermaidPreview.ts'),
].join('\n')

const REQUIRED_GROUPS = {
  document: ['font-body', 'document-text', 'document-selection-bg', 'paragraph-spacing'],
  headings: Array.from({ length: 6 }, (_, index) => `heading-${index + 1}-color`),
  inline: ['strong-weight', 'highlight-bg', 'link-color', 'inline-code-bg'],
  blocks: ['horizontal-rule-color', 'quote-border', 'list-marker-color', 'task-checked-bg'],
  callouts: ['callout-bg', 'callout-warning-bg', 'callout-important-bg'],
  code: ['code-bg', 'code-border', 'code-text', 'code-keyword', 'code-string', 'code-comment'],
  tables: ['table-border', 'table-header-bg', 'table-stripe-bg', 'table-active-bg'],
  images: ['image-radius', 'image-border', 'image-shadow'],
  math: ['math-text', 'math-display-bg', 'math-display-border'],
  mermaid: ['mermaid-bg', 'diagram-node-bg', 'diagram-node-border', 'diagram-text'],
}

describe('theme contract v1', () => {
  it.each(Object.entries(REQUIRED_GROUPS))('defines and consumes every %s variable', (_, names) => {
    for (const name of names) {
      const variable = `--xmd-${name}`
      expect(contract, `${variable} is not defined`).toContain(`${variable}:`)
      expect(consumers, `${variable} has no renderer consumer`).toContain(variable)
    }
  })

  it('loads the contract immediately after the built-in palette', () => {
    const index = read('../styles/index.css')
    expect(index.indexOf("@import './slices/foundation.css'")).toBeLessThan(
      index.indexOf("@import './slices/theme-contract.css'"),
    )
  })

  it('ships a complete example theme without internal CodeMirror selectors', () => {
    const example = read('../../docs/examples/themes/morandi.css')
    for (const names of Object.values(REQUIRED_GROUPS)) {
      expect(names.some((name) => example.includes(`--xmd-${name}:`))).toBe(true)
    }
    expect(example).not.toMatch(/\.ͼ\d/)
  })
})
