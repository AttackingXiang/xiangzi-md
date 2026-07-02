import { describe, expect, it } from 'vitest'
import { parseOutline } from './outline'

describe('parseOutline', () => {
  it('parses ATX headings at all levels', () => {
    const result = parseOutline('# H1\n## H2\n### H3')
    expect(result).toEqual([
      { level: 1, text: 'H1', index: 0 },
      { level: 2, text: 'H2', index: 1 },
      { level: 3, text: 'H3', index: 2 },
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
      { level: 1, text: 'Real', index: 0 },
      { level: 2, text: 'Also real', index: 1 },
    ])
  })

  it('skips headings inside tilde-fenced code blocks', () => {
    const md = '# Real\n~~~\n# Fake\n~~~\n## Also real'
    const result = parseOutline(md)
    expect(result.map((it) => it.text)).toEqual(['Real', 'Also real'])
  })

  it('strips trailing ATX markers', () => {
    const result = parseOutline('## Clean ##')
    expect(result).toEqual([{ level: 2, text: 'Clean', index: 0 }])
  })

  it('does not treat --- thematic breaks as headings', () => {
    const md = 'Some paragraph\n---\n## Real heading'
    const result = parseOutline(md)
    // Only the ATX heading should appear; --- is a thematic break, not a heading
    expect(result).toEqual([{ level: 2, text: 'Real heading', index: 0 }])
  })

  it('returns empty array for content with no headings', () => {
    expect(parseOutline('Just plain text\nNo headings here')).toEqual([])
  })
})
