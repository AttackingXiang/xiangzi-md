import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeEditableFencedCode } from './codeBlockDetection'
import { formatJsonSource, isFormattableJsonLanguage } from './jsonCodeBlock'

describe('isFormattableJsonLanguage', () => {
  it('accepts a json fence however it was capitalised or padded', () => {
    expect(isFormattableJsonLanguage('json')).toBe(true)
    expect(isFormattableJsonLanguage('JSON')).toBe(true)
    expect(isFormattableJsonLanguage('  Json  ')).toBe(true)
  })

  it('rejects the JSON dialects language-data aliases to json', () => {
    // These resolve to `json` for highlighting, but their whole point is
    // syntax `JSON.parse` rejects — the button must not appear.
    for (const language of ['jsonc', 'json5', 'geojson']) {
      expect(isFormattableJsonLanguage(language)).toBe(false)
    }
  })

  it('rejects an unlabelled or unrelated fence', () => {
    expect(isFormattableJsonLanguage('')).toBe(false)
    expect(isFormattableJsonLanguage('js')).toBe(false)
    expect(isFormattableJsonLanguage('javascript')).toBe(false)
  })
})

describe('formatJsonSource', () => {
  it('re-indents with two spaces', () => {
    expect(formatJsonSource('{"a":1,"b":[2,3]}')).toEqual({
      ok: true,
      text: '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    })
  })

  it('collapses whitespace-only differences into the canonical form', () => {
    const result = formatJsonSource('{\n    "a":    1\n}')
    expect(result).toEqual({ ok: true, text: '{\n  "a": 1\n}' })
  })

  it('reports the parse error rather than throwing', () => {
    const result = formatJsonSource('{"a": 1,}')
    expect(result?.ok).toBe(false)
    if (result && !result.ok) expect(result.message).toBeTruthy()
  })

  it('returns null when the block is already formatted, so undo stays clean', () => {
    expect(formatJsonSource('{\n  "a": 1\n}')).toBeNull()
  })

  it('formats top-level scalars and empty containers without complaint', () => {
    expect(formatJsonSource('  12  ')).toEqual({ ok: true, text: '12' })
    expect(formatJsonSource('[ ]')).toEqual({ ok: true, text: '[]' })
    expect(formatJsonSource('null')).toBeNull()
  })

  it('treats an empty block as a parse failure, not a silent no-op', () => {
    const result = formatJsonSource('')
    expect(result?.ok).toBe(false)
  })
})

/**
 * The overlay button drives these two helpers through the fenced-code block
 * under the cursor. Its own visibility depends on measured layout, which no
 * headless DOM provides, so cover the composition the click actually performs:
 * locate the active block, decide from its info string, format its body range.
 */
describe('formatting the fenced code block under the cursor', () => {
  const blockAt = (
    doc: string,
    cursor: number,
  ): { language: string; codeFrom: number; codeTo: number } | null => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown()],
    })
    return activeEditableFencedCode(state)
  }

  it('rewrites only the body, leaving fences and surrounding prose intact', () => {
    const doc = '# Title\n\n```json\n{"a":1,"b":[2]}\n```\n\ntail\n'
    const block = blockAt(doc, doc.indexOf('{"a"'))
    expect(block).not.toBeNull()
    if (!block) return
    expect(isFormattableJsonLanguage(block.language)).toBe(true)

    const result = formatJsonSource(doc.slice(block.codeFrom, block.codeTo))
    expect(result).toEqual({ ok: true, text: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}' })
    if (!result?.ok) return
    expect(doc.slice(0, block.codeFrom) + result.text + doc.slice(block.codeTo)).toBe(
      '# Title\n\n```json\n{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n```\n\ntail\n',
    )
  })

  it('declines the json5 and unlabelled fences the button must not appear on', () => {
    const json5 = '```json5\n{a: 1}\n```\n'
    expect(isFormattableJsonLanguage(blockAt(json5, json5.indexOf('{a'))?.language ?? '')).toBe(
      false,
    )
    const plain = '```\n{"a":1}\n```\n'
    expect(isFormattableJsonLanguage(blockAt(plain, plain.indexOf('{"a'))?.language ?? '')).toBe(
      false,
    )
  })

  it('picks the block the cursor is in when a document holds several', () => {
    const doc = '```json\n{"a":1}\n```\n\ntext\n\n```json\n{"b":2}\n```\n'
    const second = blockAt(doc, doc.indexOf('{"b"'))
    expect(second).not.toBeNull()
    if (!second) return
    expect(doc.slice(second.codeFrom, second.codeTo)).toBe('{"b":2}')
  })
})
