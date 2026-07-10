import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('TextEditor theme styles', () => {
  it('keeps the CodeMirror search panel on the shared flat editor surface', () => {
    const css = readFileSync(new URL('../styles/slices/text-editor.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.cm-panels\s*\{[\s\S]*?background: var\(--editor-chrome-bg\)/)
    expect(css).toMatch(/\.cm-textfield\s*\{[\s\S]*?background: transparent/)
    expect(css).toMatch(/\.cm-button\s*\{[\s\S]*?background: transparent/)
    expect(css).toContain('accent-color: var(--accent)')
  })
})
