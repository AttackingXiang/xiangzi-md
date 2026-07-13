import { describe, expect, it } from 'vitest'
import { markdownCodeBlocks, renderMarkdownSource } from './generateExportHtml'

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

describe('renderMarkdownSource', () => {
  it('renders the complete source without requiring mounted editor DOM', () => {
    const markdown = '# Visible\n\nfirst\n\n## Far outside the viewport\n\nlast paragraph'
    const html = renderMarkdownSource(markdown)
    expect(html).toContain('<h1>Visible</h1>')
    expect(html).toContain('<h2>Far outside the viewport</h2>')
    expect(html).toContain('<p>last paragraph</p>')
  })

  it('supports GFM tables, tasks, links, images and fenced code', () => {
    const html = renderMarkdownSource(
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n[link](https://example.com) ![alt](image.png)\n\n```ts\nconst x = 1\n```',
    )
    expect(html).toContain('<table>')
    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('type="checkbox" disabled checked')
    expect(html).toContain('<a href="https://example.com">link</a>')
    expect(html).toContain('<img src="image.png" alt="alt">')
    expect(html).toContain('<code class="language-ts">const x = 1')
  })

  it('escapes raw HTML instead of exporting executable source markup', () => {
    expect(renderMarkdownSource('<script>alert(1)</script>')).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })
})
