/** Remove clipboard-only image placeholders that Crepe would render as an empty image editor. */
export function sanitizePastedHtml(html: string): string {
  if (!html || !/<img\b/i.test(html)) return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const source = image.getAttribute('src')?.trim()
    if (isEmptyClipboardImageSource(source)) image.remove()
  })
  return template.innerHTML
}

export function isEmptyClipboardImageSource(source: string | undefined): boolean {
  return !source || source === 'about:blank'
}

/**
 * CommonMark treats a single newline as a soft break. Text copied from chats and
 * text editors is expected to keep its visual lines, so turn only single newlines
 * into Markdown hard breaks while preserving blank lines as paragraph breaks.
 */
export function preservePlainTextLineBreaks(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  return normalized.replace(/(^|[^\n])\n(?=[^\n])/g, '$1  \n')
}

/** Structured Markdown should keep going through Milkdown's normal Markdown parser. */
export function shouldPreservePlainTextLineBreaks(text: string): boolean {
  if (!/[\r\n]/.test(text)) return false
  return !text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .some((line) =>
      /^(?: {0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})| {4}\S|\t\S)/.test(line),
    )
}
