export interface ClipboardFormattingOptions {
  copyTextColor: boolean
  copyHighlightColor: boolean
}

export const DEFAULT_CLIPBOARD_FORMATTING: ClipboardFormattingOptions = {
  copyTextColor: false,
  copyHighlightColor: false,
}

/** Only values that cannot escape a single CSS color declaration are accepted. */
export function safeClipboardColor(value: string): string | null {
  const color = value.trim()
  if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color)) return color
  if (/^[a-z]+$/i.test(color)) return color
  return null
}
