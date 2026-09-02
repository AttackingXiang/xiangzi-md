import { describe, expect, it } from 'vitest'
import { normalizeEditorDocument } from '../features/cm6-editor/sync'
import {
  outlineDescendantEnd,
  outlineHasChildren,
  parseOutline,
  visibleOutlineIndices,
} from './outline'

describe('parseOutline', () => {
  it('parses ATX headings at all levels', () => {
    const result = parseOutline('# H1\n## H2\n### H3')
    expect(result).toEqual([
      { level: 1, text: 'H1', index: 0, offset: 0 },
      { level: 2, text: 'H2', index: 1, offset: 5 },
      { level: 3, text: 'H3', index: 2, offset: 11 },
    ])
  })

  it('assigns sequential indices matching DOM heading order', () => {
    const md = '# First\n\nsome text\n\n## Second\n\n### Third'
    const result = parseOutline(md)
    expect(result.map((it) => it.index)).toEqual([0, 1, 2])
  })

  it('skips headings inside fenced code blocks', () => {
    const md = '# Real\n```\n# Fake\n```\n## Also real'
    const result = parseOutline(md)
    expect(result).toEqual([
      { level: 1, text: 'Real', index: 0, offset: 0 },
      { level: 2, text: 'Also real', index: 1, offset: 22 },
    ])
  })

  it('skips headings inside tilde-fenced code blocks', () => {
    const md = '# Real\n~~~\n# Fake\n~~~\n## Also real'
    const result = parseOutline(md)
    expect(result.map((it) => it.text)).toEqual(['Real', 'Also real'])
  })

  it('strips trailing ATX markers', () => {
    const result = parseOutline('## Clean ##')
    expect(result).toEqual([{ level: 2, text: 'Clean', index: 0, offset: 0 }])
  })

  it('shows visible inline text and Setext headings', () => {
    const result = parseOutline('   # **Bold** [link](next.md)\nSetext `code`\n===\n')
    expect(result).toEqual([
      { level: 1, text: 'Bold link', index: 0, offset: 0 },
      { level: 1, text: 'Setext code', index: 1, offset: 30 },
    ])
  })

  it('does not treat --- thematic breaks as headings', () => {
    const md = 'Some paragraph\n\n---\n## Real heading'
    const result = parseOutline(md)
    expect(result).toEqual([{ level: 2, text: 'Real heading', index: 0, offset: 20 }])
  })

  it('returns empty array for content with no headings', () => {
    expect(parseOutline('Just plain text\nNo headings here')).toEqual([])
  })

  it('treats skipped heading levels as descendants of the nearest lower-level heading', () => {
    const items = parseOutline('# A\n### A.1\n#### A.1.1\n## B\n### B.1\n# C')
    expect(outlineHasChildren(items, 0)).toBe(true)
    expect(outlineDescendantEnd(items, 0)).toBe(5)
    expect(visibleOutlineIndices(items, new Set([0]))).toEqual([0, 5])
  })

  it('keeps siblings visible when only a nested section is collapsed', () => {
    const items = parseOutline('# A\n## A.1\n### A.1.1\n## A.2\n# B')
    expect(visibleOutlineIndices(items, new Set([1]))).toEqual([0, 1, 3, 4])
  })
})

// App.tsx feeds every outline offset straight to CodeMirror (revealHeading /
// lineBlockAt), and CM6's document is always LF. The outline must therefore be
// parsed from the same LF-normalized text the editor holds, never from the raw
// CRLF file — otherwise offsets drift one char per preceding line and clicking a
// heading in a long CRLF document scrolls to the wrong line.
describe('parseOutline CRLF coordinate model', () => {
  it('offsets computed from raw CRLF text drift past the LF editor position', () => {
    const crlf = '# A\r\nbody\r\n\r\n## B\r\nmore\r\n\r\n### C\r\n'
    const raw = parseOutline(crlf)
    const lf = normalizeEditorDocument(crlf)
    // Raw CRLF offsets do not land on the '#' once the doc is LF.
    expect(raw.slice(1).every((h) => lf[h.offset] === '#')).toBe(false)
  })

  it('normalizing first makes every offset land exactly on its heading marker', () => {
    const crlf = '# A\r\nbody\r\n\r\n## B\r\nmore\r\n\r\n### C\r\n'
    const lf = normalizeEditorDocument(crlf)
    const items = parseOutline(lf)
    expect(items.map((h) => h.text)).toEqual(['A', 'B', 'C'])
    for (const item of items) expect(lf[item.offset]).toBe('#')
  })

  it('matches the offsets of the equivalent LF-authored document', () => {
    const body = '# A\nintro\n\n## B\ndetail\n\n## C\nend\n'
    const fromLf = parseOutline(body)
    const fromCrlf = parseOutline(normalizeEditorDocument(body.replace(/\n/g, '\r\n')))
    expect(fromCrlf).toEqual(fromLf)
  })

  it('keeps a CRLF frontmatter body aligned after normalization', () => {
    // Mirrors App.tsx non-source mode: outline runs on the frontmatter-stripped
    // body, which is a slice of the raw CRLF file and still carries \r\n.
    const crlfBody = '# Title\r\n\r\ntext\r\n\r\n## Section\r\nmore text\r\n'
    const lfBody = normalizeEditorDocument(crlfBody)
    const items = parseOutline(lfBody)
    expect(items.map((h) => h.text)).toEqual(['Title', 'Section'])
    for (const item of items) {
      expect(lfBody.slice(item.offset).startsWith('#')).toBe(true)
    }
  })

  it('holds alignment across a long document where drift is largest', () => {
    const lines: string[] = []
    for (let i = 0; i < 400; i += 1) lines.push(`filler line ${i}`)
    lines.push('# Deep Heading')
    for (let i = 0; i < 200; i += 1) lines.push(`tail line ${i}`)
    lines.push('## Deeper Heading')
    const lf = lines.join('\n')
    const crlfNormalized = normalizeEditorDocument(lines.join('\r\n'))
    expect(crlfNormalized).toBe(lf)
    const items = parseOutline(crlfNormalized)
    expect(items.map((h) => h.text)).toEqual(['Deep Heading', 'Deeper Heading'])
    for (const item of items) expect(lf[item.offset]).toBe('#')
  })
})
