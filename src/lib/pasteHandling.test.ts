import { describe, expect, it } from 'vitest'
import {
  isEmptyClipboardImageSource,
  preservePlainTextLineBreaks,
  shouldPreservePlainTextLineBreaks,
} from './pasteHandling'

describe('paste handling', () => {
  it('identifies empty clipboard image placeholders but keeps real images', () => {
    expect(isEmptyClipboardImageSource(undefined)).toBe(true)
    expect(isEmptyClipboardImageSource('')).toBe(true)
    expect(isEmptyClipboardImageSource('about:blank')).toBe(true)
    expect(isEmptyClipboardImageSource('real.png')).toBe(false)
  })

  it('keeps visual lines without destroying paragraph breaks', () => {
    expect(preservePlainTextLineBreaks('a\r\nb\n\nc\nd')).toBe('a  \nb\n\nc  \nd')
  })

  it('leaves structured Markdown to the normal parser', () => {
    expect(shouldPreservePlainTextLineBreaks('first\nsecond')).toBe(true)
    expect(shouldPreservePlainTextLineBreaks('- first\n- second')).toBe(false)
    expect(shouldPreservePlainTextLineBreaks('```ts\nconst x = 1\n```')).toBe(false)
    expect(shouldPreservePlainTextLineBreaks('    indented code\n    next')).toBe(false)
  })
})
