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

  it('uses a hanging indent so wrapped list content stays aligned with its first line', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const listLine = css.match(/\.cm-line\.xmd-cm-list-line\s*\{([^}]*)\}/)?.[1]

    expect(listLine).toContain('--xmd-list-hang:')
    expect(listLine).toContain('padding-inline-start:')
    expect(listLine).toContain('text-indent: calc(0px - var(--xmd-list-hang))')
  })

  it('keeps preserved line-leading source measurable but visually negligible', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const hiddenSource = css.match(/\.xmd-cm-preserved-hidden-source\s*\{([^}]*)\}/)?.[1]

    expect(hiddenSource).toContain('display: inline-block')
    expect(hiddenSource).toContain('inline-size: 0.125px')
    expect(hiddenSource).toContain('color: transparent')
    expect(hiddenSource).toContain('line-height: inherit')
    expect(hiddenSource).toContain('overflow: clip')
    expect(hiddenSource).not.toContain('line-height: 0')
    const hiddenSourceChildren = css.match(
      /\.xmd-cm-preserved-hidden-source > \*\s*\{([^}]*)\}/,
    )?.[1]
    expect(hiddenSourceChildren).toContain('font-size: 0.125px')
    expect(hiddenSourceChildren).toContain('line-height: 0')
    expect(hiddenSource).not.toContain('display: none')
    expect(hiddenSource).not.toContain('position: absolute')
    expect(hiddenSource).not.toContain('user-select: none')
  })

  it('uses native painting only while the single-line selection class is active', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const hidesLayer = css.match(
      /\.xmd-cm-native-line-selection \.cm-selectionLayer\s*\{([^}]*)\}/,
    )?.[1]
    const nativeSelection = css.match(
      /\.xmd-cm-native-line-selection \.cm-line \*::selection\s*\{([^}]*)\}/,
    )?.[1]

    expect(hidesLayer).toContain('display: none')
    expect(nativeSelection).toContain('var(--accent)')
    expect(nativeSelection).toContain('!important')
  })

  it('uses the configured code-block opacity for the editor card surface', () => {
    const css = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')
    const card = css.match(/\.cm-line\.xmd-cm-code-line::before\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(card).toContain('var(--code-block-opacity, 30%)')
    expect(card).toContain('transparent')
  })
})
