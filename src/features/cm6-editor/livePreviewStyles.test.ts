import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CM6 live preview styles', () => {
  it('keeps thematic breaks full-width with compact vertical spacing', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const line = css.match(/\.cm-line\.xmd-cm-horizontal-rule\s*\{([^}]*)\}/)?.[1]
    const widget = css.match(/\.xmd-cm-horizontal-rule-widget\s*\{([^}]*)\}/)?.[1]
    const rule = css.match(/\.xmd-cm-horizontal-rule-widget::after\s*\{([^}]*)\}/)?.[1]

    expect(line).toContain('padding-block: 0.24em')
    expect(line).toContain('line-height: 0')
    expect(line).toContain('min-height: 0')
    expect(widget).toContain('width: 100%')
    expect(widget).not.toContain('max-width')
    expect(widget).not.toContain('border-top:')
    expect(rule).toContain('border-top:')
    expect(rule).toContain('z-index: 1')
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

  it('uses native painting only while the native selection class is active', () => {
    const css = readFileSync(new URL('./livePreview.css', import.meta.url), 'utf8')
    const editorCss = readFileSync(new URL('./editor.css', import.meta.url), 'utf8')
    const hidesLayer = css.match(
      /\.xmd-cm-native-line-selection \.cm-selectionLayer\s*\{([^}]*)\}/,
    )?.[1]
    const nativeSelection = editorCss.match(
      /\.xmd-cm-native-selection \.cm-content \*::selection\s*\{([^}]*)\}/,
    )?.[1]
    const cm6Selection = editorCss.match(
      /\.cm-focused \.cm-selectionLayer \.cm-selectionBackground\s*\{([\s\S]*?)\n\}/,
    )?.[1]

    expect(hidesLayer).toContain('display: none')
    expect(nativeSelection).toContain('background-color:')
    expect(nativeSelection).toContain('var(--xmd-document-selection-bg)')
    expect(nativeSelection).toContain('!important')
    expect(cm6Selection).toContain('var(--xmd-document-selection-bg)')
    expect(cm6Selection).toContain('!important')
  })

  it('uses the configured code-block opacity for the editor card surface', () => {
    const css = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')
    const surface = css.match(/\.cm-line\.xmd-cm-code-line::before\s*\{([\s\S]*?)\n\}/)?.[1]
    const outline = css.match(/\.cm-line\.xmd-cm-code-line::after\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(surface).toContain('var(--code-block-opacity, 30%)')
    expect(surface).toContain('transparent')
    expect(surface).toContain('z-index: -5')
    expect(surface).not.toContain('border-left:')
    expect(outline).toContain('border-left: 1px solid var(--xmd-code-border)')
    expect(outline).toContain('border-right: 1px solid var(--xmd-code-border)')
    expect(outline).toContain('z-index: 1')
  })

  it('keeps every code-card edge on the foreground outline', () => {
    const css = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')

    expect(css).toMatch(
      /\.cm-line\.xmd-cm-code-line-first::after\s*\{\s*border-top: 1px solid var\(--xmd-code-border\)/,
    )
    expect(css).toMatch(
      /\.cm-line\.xmd-cm-code-line-last::after\s*\{\s*border-bottom: 1px solid var\(--xmd-code-border\)/,
    )
  })

  it('hides CM6 painting for native code-block selections', () => {
    const css = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')
    const hidesLayer = css.match(
      /\.xmd-cm-native-code-selection \.cm-selectionLayer\s*\{([^}]*)\}/,
    )?.[1]

    expect(hidesLayer).toContain('display: none')
  })
})
