import { describe, expect, it } from 'vitest'
import { escapeHtmlText, inlineCodeHighlightStyles, serializeStyleSheets } from './exportStyles'

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

  it('freezes resolved CodeMirror token colors into an export clone', () => {
    const sourceNodes = [{}, {}, {}] as Element[]
    const createTarget = (): HTMLElement => {
      const values = new Map<string, string>()
      const priorities = new Map<string, string>()
      return {
        style: {
          setProperty: (property: string, value: string, priority?: string) => {
            values.set(property, value)
            priorities.set(property, priority ?? '')
          },
          getPropertyValue: (property: string) => values.get(property) ?? '',
          getPropertyPriority: (property: string) => priorities.get(property) ?? '',
        },
      } as unknown as HTMLElement
    }
    const clonedNodes = [createTarget(), createTarget(), createTarget()]
    const source = {
      querySelectorAll: () => sourceNodes,
    } as unknown as ParentNode
    const clone = {
      querySelectorAll: () => clonedNodes,
    } as unknown as ParentNode
    const styles = new Map<Element, Record<string, string>>()
    styles.set(sourceNodes[0], { color: 'rgb(36, 41, 47)' })
    styles.set(sourceNodes[1], { color: 'rgb(36, 41, 47)' })
    styles.set(sourceNodes[2], {
      color: 'rgb(207, 34, 46)',
      'font-weight': '600',
    })

    inlineCodeHighlightStyles(source, clone, (element) => {
      const values = styles.get(element) ?? {}
      return {
        getPropertyValue: (property: string) => values[property] ?? '',
      } as CSSStyleDeclaration
    })

    const token = clonedNodes[2]
    expect(token.style.getPropertyValue('color')).toBe('rgb(207, 34, 46)')
    expect(token.style.getPropertyPriority('color')).toBe('important')
    expect(token.style.getPropertyValue('-webkit-text-fill-color')).toBe('rgb(207, 34, 46)')
    expect(token.style.getPropertyValue('font-weight')).toBe('600')
  })
})
