import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CM6 live preview styles', () => {
  it('keeps thematic breaks full-width with compact vertical spacing', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const line = css.match(/\.cm-line\.xmd-cm-horizontal-rule\s*\{([^}]*)\}/)?.[1]
    const widget = css.match(/\.xmd-cm-horizontal-rule-widget\s*\{([^}]*)\}/)?.[1]

    expect(line).toContain('padding-block: 0.24em')
    expect(line).toContain('line-height: 0')
    expect(line).toContain('min-height: 0')
    expect(widget).toContain('width: 100%')
    expect(widget).not.toContain('max-width')
  })
})
