import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const editorCss = readFileSync(new URL('./editor.css', import.meta.url), 'utf8')

describe('CM6 editor layout contract', () => {
  it('keeps the viewport-rendered editor at a stable flex width', () => {
    expect(editorCss).toMatch(/\.xmd-cm-editor\s*\{[^}]*flex:\s*1 1 0;/s)
    expect(editorCss).toMatch(/\.xmd-cm-editor\s*\{[^}]*min-width:\s*0;/s)
    expect(editorCss).toMatch(/\.xmd-cm-mount[^}]*width:\s*100%;/s)
  })

  it('prevents viewport-mounted content from creating document-level horizontal overflow', () => {
    expect(editorCss).toMatch(/\.xmd-cm-editor \.cm-scroller\s*\{[^}]*overflow-x:\s*hidden;/s)
    expect(editorCss).toMatch(/\.xmd-cm-editor \.cm-sizer\s*\{[^}]*width:\s*100%;/s)
    expect(editorCss).toMatch(/\.xmd-cm-editor \.cm-sizer\s*\{[^}]*min-width:\s*0;/s)
  })
})
