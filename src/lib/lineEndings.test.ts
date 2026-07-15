import { describe, expect, it } from 'vitest'
import { applyLineEnding, detectLineEnding } from './lineEndings'

describe('detectLineEnding', () => {
  it('detects a pure CRLF file', () => {
    expect(detectLineEnding('# Title\r\n\r\nBody line 1\r\nBody line 2\r\n')).toBe('crlf')
  })

  it('detects a pure LF file', () => {
    expect(detectLineEnding('# Title\n\nBody line 1\nBody line 2\n')).toBe('lf')
  })

  it('falls back to lf on an exact tie between CRLF pairs and lone LFs', () => {
    // 2 CRLF pairs, 2 lone LFs — tie must not count as 'crlf' (strictly-greater rule).
    expect(detectLineEnding('a\r\nb\nc\r\nd\n')).toBe('lf')
  })

  it('picks crlf only when CRLF pairs strictly outnumber lone LFs', () => {
    expect(detectLineEnding('a\r\nb\r\nc\nd\r\n')).toBe('crlf') // 3 crlf vs 1 lone lf
    expect(detectLineEnding('a\r\nb\nc\nd\n')).toBe('lf') // 1 crlf vs 3 lone lf
  })

  it('treats a file with no line breaks as lf', () => {
    expect(detectLineEnding('single line, no newline at all')).toBe('lf')
  })

  it('treats an empty file as lf', () => {
    expect(detectLineEnding('')).toBe('lf')
  })

  it('treats lone (old-Mac-style) CR as lf, not its own style', () => {
    // No \n at all, so nothing is ever counted as crlf — the fallback rule (lf) applies.
    expect(detectLineEnding('a\rb\rc')).toBe('lf')
  })

  it('does not let a lone CR elsewhere in the string be mistaken for a crlf pair', () => {
    // A lone \r and a separate lone \n, with no \r immediately followed by \n
    // anywhere — must not register as a crlf pair.
    expect(detectLineEnding('a\rb\nc\rd')).toBe('lf')
  })
})

describe('applyLineEnding', () => {
  it('leaves pure LF content untouched when target is lf', () => {
    const content = 'line 1\nline 2\nline 3'
    expect(applyLineEnding(content, 'lf')).toBe(content)
  })

  it('expands every LF to CRLF when target is crlf', () => {
    expect(applyLineEnding('line 1\nline 2\nline 3\n', 'crlf')).toBe(
      'line 1\r\nline 2\r\nline 3\r\n',
    )
  })

  it('is idempotent: re-applying crlf to already-CRLF content does not double the CR', () => {
    const once = applyLineEnding('a\nb\nc\n', 'crlf')
    const twice = applyLineEnding(once, 'crlf')
    expect(twice).toBe(once)
    expect(twice).not.toMatch(/\r\r/)
  })

  it('normalizes CRLF/mixed input down to LF when target is lf', () => {
    expect(applyLineEnding('a\r\nb\nc\r\n', 'lf')).toBe('a\nb\nc\n')
  })

  it('normalizes lone CR defensively before expanding to crlf', () => {
    expect(applyLineEnding('a\rb\nc', 'crlf')).toBe('a\r\nb\r\nc')
  })

  it('handles an empty string for both targets', () => {
    expect(applyLineEnding('', 'lf')).toBe('')
    expect(applyLineEnding('', 'crlf')).toBe('')
  })
})

describe('read -> edit -> save round trip', () => {
  // Stand-in for CM6's own normalization (cm6-editor/sync.ts::normalizeEditorDocument),
  // reproduced here rather than imported so this test stays decoupled from the
  // editor internals, which are off-limits for this change and under active
  // work elsewhere. The two functions are intentionally identical in behavior:
  // both collapse \r\n and lone \r down to \n.
  const enterEditor = (raw: string): string => raw.replace(/\r\n?/g, '\n')

  it('preserves a CRLF file across open -> edit -> save with an edit far from the diff', () => {
    const onDisk = 'line 1\r\nline 2\r\nline 3\r\nline 4\r\n'
    const eol = detectLineEnding(onDisk)
    expect(eol).toBe('crlf')

    // Opening the file hands the raw bytes to the editor, which immediately
    // normalizes its internal model to LF.
    const editorMirror = enterEditor(onDisk)
    expect(editorMirror).toBe('line 1\nline 2\nline 3\nline 4\n')

    // A single-character edit anywhere still yields a full pure-LF string —
    // this is exactly the "onChange reports the whole mirror" behavior that
    // makes line-ending loss possible without this module.
    const editedMirror = editorMirror.replace('line 2', 'line 2 edited')
    expect(editedMirror).toBe('line 1\nline 2 edited\nline 3\nline 4\n')

    // Saving must restore the document's original CRLF style, using the eol
    // captured at open time (not re-detected from the now-pure-LF buffer,
    // which would always say 'lf' and lose the original signal).
    const written = applyLineEnding(editedMirror, eol)
    expect(written).toBe('line 1\r\nline 2 edited\r\nline 3\r\nline 4\r\n')
    expect(written).toMatch(/\r\n/)
    expect(written).not.toMatch(/[^\r]\n/) // every \n is still preceded by \r
  })

  it('keeps an LF file pure LF across the same round trip', () => {
    const onDisk = 'alpha\nbeta\ngamma\n'
    const eol = detectLineEnding(onDisk)
    expect(eol).toBe('lf')

    const editorMirror = enterEditor(onDisk)
    const editedMirror = editorMirror.replace('beta', 'beta edited')
    const written = applyLineEnding(editedMirror, eol)

    expect(written).toBe('alpha\nbeta edited\ngamma\n')
    expect(written).not.toMatch(/\r/)
  })

  it('does not corrupt content when no edit happens (round trip is a no-op)', () => {
    const onDisk = 'a\r\nb\r\nc\r\n'
    const eol = detectLineEnding(onDisk)
    const editorMirror = enterEditor(onDisk)
    const written = applyLineEnding(editorMirror, eol)
    expect(written).toBe(onDisk)
  })
})
