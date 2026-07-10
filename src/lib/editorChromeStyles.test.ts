import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('editor chrome styles', () => {
  it('keeps the toolbar and property panels flat like the tab bar', () => {
    const root = new URL('../styles/slices/', import.meta.url)
    const foundation = readFileSync(new URL('foundation.css', root), 'utf8')
    const toolbar = readFileSync(new URL('editor-toolbar.css', root), 'utf8')
    const tags = readFileSync(new URL('tags.css', root), 'utf8')
    const toolbarSurface = toolbar.match(/^\.editor-toolbar\s*\{[\s\S]*?^\}/m)?.[0] ?? ''

    expect(foundation).toContain('--editor-chrome-bg: transparent')
    expect(toolbar).toContain('background: var(--editor-chrome-bg)')
    expect(toolbarSurface).not.toContain('backdrop-filter')
    expect(toolbarSurface).not.toContain('box-shadow')
    expect(tags.match(/background: var\(--editor-chrome-bg\)/g)).toHaveLength(2)
    expect(tags).not.toContain('backdrop-filter')
    expect(tags).not.toContain('editor-chrome-shadow')
  })
})
