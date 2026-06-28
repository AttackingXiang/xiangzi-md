function styleRules(sheet: CSSStyleSheet): string[] {
  if (sheet.disabled) return []
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText)
  } catch {
    // Browsers block cssRules for cross-origin sheets. Export must remain usable
    // even when an optional external stylesheet cannot be inspected.
    return []
  }
}

export function serializeStyleSheets(styleSheets: Iterable<CSSStyleSheet>): string {
  return Array.from(styleSheets)
    .flatMap(styleRules)
    .join('\n')
    .replace(/<\/style/gi, '<\\/style')
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CODE_STYLE_SELECTOR = '.cm-content, .cm-line, .cm-line span'
const CODE_STYLE_PROPERTIES = [
  'color',
  'font-style',
  'font-weight',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
] as const

type StyleReader = (element: Element) => CSSStyleDeclaration

/**
 * CodeMirror assigns generated class names to syntax tokens. Those class names
 * are only stable inside the live document and may be remapped when the export
 * is opened in another WebView/browser. Snapshot the resolved token styles so
 * HTML, image and PDF exports all retain exactly what the editor displayed.
 */
export function inlineCodeHighlightStyles(
  sourceRoot: ParentNode,
  clonedRoot: ParentNode,
  readStyle: StyleReader = (element) => window.getComputedStyle(element),
): void {
  const sourceNodes = Array.from(sourceRoot.querySelectorAll<HTMLElement>(CODE_STYLE_SELECTOR))
  const clonedNodes = Array.from(clonedRoot.querySelectorAll<HTMLElement>(CODE_STYLE_SELECTOR))

  sourceNodes.slice(0, clonedNodes.length).forEach((source, index) => {
    const target = clonedNodes[index]
    const computed = readStyle(source)

    for (const property of CODE_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property).trim()
      if (value) target.style.setProperty(property, value, 'important')
    }

    const color = computed.getPropertyValue('color').trim()
    if (color) target.style.setProperty('-webkit-text-fill-color', color, 'important')
  })
}
