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

    expect(hiddenSource).toContain('font-size: 0.125px')
    expect(hiddenSource).toContain('color: transparent')
    expect(hiddenSource).toContain('line-height: 0')
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

  it('keeps the code-block controls gutter as a single CSS custom property, not a duplicated magic number', () => {
    // codeBlockPreview.ts's CodeBlockScrollPlugin reads this same
    // `--xmd-code-controls-gutter` custom property (via getComputedStyle) so
    // the caret reveal-scroll math and this padding can never drift apart
    // the way two separately hardcoded `176`s once could.
    const editorCss = readFileSync(new URL('./editor.css', import.meta.url), 'utf8')
    const codeBlockCss = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')
    const editorScope = editorCss.match(/\.xmd-cm-editor\s*\{([^}]*)\}/)?.[1]
    const firstLineContent = codeBlockCss.match(
      /\.xmd-cm-code-line-first \.xmd-cm-code-line-content\s*\{([^}]*)\}/,
    )?.[1]

    expect(editorScope).toContain('--xmd-code-controls-gutter:')
    // The `176px` after the comma is `var()`'s own CSS-level fallback (used
    // only if the custom property somehow fails to resolve) — the padding
    // rule itself must reference the variable, not repeat the literal value.
    expect(firstLineContent).toContain('padding-inline-end: var(--xmd-code-controls-gutter')
  })

  it('uses the configured code-block opacity for the editor card surface', () => {
    const css = readFileSync(new URL('./codeBlockPreview.css', import.meta.url), 'utf8')
    const card = css.match(/\.cm-line\.xmd-cm-code-line::before\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(card).toContain('var(--code-block-opacity, 30%)')
    expect(card).toContain('transparent')
  })
})
