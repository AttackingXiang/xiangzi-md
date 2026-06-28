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
