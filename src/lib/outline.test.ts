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

  it('parses setext level-1 headings (===)', () => {
    const result = parseOutline('My Title\n========')
    expect(result).toEqual([{ level: 1, text: 'My Title', index: 0 }])
  })

  it('parses setext level-2 headings (---)', () => {
    const result = parseOutline('Subtitle\n--------')
    expect(result).toEqual([{ level: 2, text: 'Subtitle', index: 0 }])
  })

  it('mixes ATX and setext headings with correct sequential indices', () => {
    const md = '# First\n\nSetext\n======\n\n## Third'
    const result = parseOutline(md)
    expect(result).toEqual([
      { level: 1, text: 'First', index: 0 },
      { level: 1, text: 'Setext', index: 1 },
      { level: 2, text: 'Third', index: 2 },
    ])
  })

  it('skips headings inside fenced code blocks', () => {
    const md = '# Real\n```\n# Fake\n```\n## Also real'
    const result = parseOutline(md)
    expect(result).toEqual([
      { level: 1, text: 'Real', index: 0 },
      { level: 2, text: 'Also real', index: 1 },
    ])
  })

  it('strips trailing ATX markers', () => {
    const result = parseOutline('## Clean ##')
    expect(result).toEqual([{ level: 2, text: 'Clean', index: 0 }])
  })

  it('returns empty array for content with no headings', () => {
    expect(parseOutline('Just plain text\nNo headings here')).toEqual([])
  })
})
