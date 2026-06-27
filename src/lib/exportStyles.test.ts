import { describe, expect, it } from 'vitest'
import { escapeHtmlText, serializeStyleSheets } from './exportStyles'

describe('exportStyles', () => {
  it('serializes linked and inline stylesheet rules instead of only style elements', () => {
    const sheets = [
      { disabled: false, cssRules: [{ cssText: '.milkdown li { display: flex; }' }] },
      { disabled: false, cssRules: [{ cssText: '.cm-editor { color: #222; }' }] },
    ] as unknown as CSSStyleSheet[]

    expect(serializeStyleSheets(sheets)).toBe(
      '.milkdown li { display: flex; }\n.cm-editor { color: #222; }',
    )
  })

  it('skips disabled and inaccessible stylesheets without breaking export', () => {
    const blocked = {
      disabled: false,
      get cssRules(): CSSRuleList {
        throw new DOMException('Blocked')
      },
    }
    const sheets = [
      { disabled: true, cssRules: [{ cssText: '.disabled {}' }] },
      blocked,
      { disabled: false, cssRules: [{ cssText: '.kept {}' }] },
    ] as unknown as CSSStyleSheet[]

    expect(serializeStyleSheets(sheets)).toBe('.kept {}')
  })

  it('escapes document titles and closing style tags', () => {
    expect(escapeHtmlText('<A & "B">')).toBe('&lt;A &amp; &quot;B&quot;&gt;')
    expect(
      serializeStyleSheets([
        { disabled: false, cssRules: [{ cssText: 'x{content:"</style>"}' }] },
      ] as unknown as CSSStyleSheet[]),
    ).toBe('x{content:"<\\/style>"}')
  })
})
