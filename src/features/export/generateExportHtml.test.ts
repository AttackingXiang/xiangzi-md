import { describe, expect, it } from 'vitest'
import { markdownCodeBlocks } from './generateExportHtml'

describe('markdownCodeBlocks', () => {
  it('supports longer backtick and tilde fences without shifting later blocks', () => {
    expect(markdownCodeBlocks('````js\na```b\n````\n\n~~~mermaid\ngraph TD\n~~~')).toEqual([
      { lang: 'js', code: 'a```b\n' },
      { lang: 'mermaid', code: 'graph TD\n' },
    ])
  })

  it('recognizes indented CommonMark code blocks', () => {
    expect(markdownCodeBlocks('text\n\n    const a = 1\n    const b = 2')).toEqual([
      { lang: '', code: 'const a = 1\nconst b = 2\n' },
    ])
  })
})
