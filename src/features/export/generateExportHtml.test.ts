import { describe, expect, it, vi } from 'vitest'
import {
  estimateExportDocumentHeight,
  exportHeadingIds,
  exportMathExpressions,
  inlineExportCssAssets,
  markdownCodeBlocks,
  preferWoff2FontSources,
  renderMarkdownSource,
} from './generateExportHtml'

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

  it('keeps code blocks nested in quotes and lists aligned with rendered pre elements', () => {
    expect(
      markdownCodeBlocks('> ```js\n> quoted()\n> ```\n\n- item\n\n  ~~~python\n  listed()\n  ~~~'),
    ).toEqual([
      { lang: 'js', code: 'quoted()\n' },
      { lang: 'python', code: 'listed()\n' },
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

  it('rejects executable link protocols', () => {
    const html = renderMarkdownSource('[unsafe](javascript:alert(1))')
    expect(html).toContain('[unsafe](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })
})

describe('export heading anchors', () => {
  it('matches editor anchor slugs and suffixes duplicates', () => {
    expect(exportHeadingIds(['Hello, **World**!', 'Hello World', '中文 标题', '!!!'])).toEqual([
      'hello-world',
      'hello-world-1',
      '中文-标题',
      '',
    ])
  })
})

describe('export math and long-document planning', () => {
  it('recognizes inline and display formulas but not currency or escaped markers', () => {
    expect(exportMathExpressions('cost $5')).toEqual([])
    expect(exportMathExpressions('\\$skip\\$')).toEqual([])
    expect(exportMathExpressions('$x^2$ then $$ y = 2 $$')).toEqual([
      { from: 0, to: 5, source: 'x^2', displayMode: false },
      { from: 11, to: 22, source: 'y = 2', displayMode: true },
    ])
  })

  it('estimates wrapped source rows instead of reading a detached zero-height DOM', () => {
    expect(estimateExportDocumentHeight('short')).toBe(156)
    expect(estimateExportDocumentHeight('x'.repeat(97))).toBe(212)
    expect(estimateExportDocumentHeight('a\nb\nc')).toBe(212)
  })

  it('inlines only same-origin formula assets and de-duplicates loads', async () => {
    const load = vi.fn((url: string) =>
      Promise.resolve(`data:font/woff2;base64,${url.endsWith('a.woff2') ? 'A' : 'B'}`),
    )
    const css = [
      '@font-face{src:url("/assets/a.woff2")}',
      '.again{src:url(/assets/a.woff2)}',
      '.external{src:url(https://cdn.example/b.woff2)}',
      '.inline{src:url(data:font/woff2;base64,OK)}',
    ].join('')

    const result = await inlineExportCssAssets(css, 'https://app.local/document', load)

    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith('https://app.local/assets/a.woff2')
    expect(result.match(/data:font\/woff2;base64,A/g)).toHaveLength(2)
    expect(result).toContain('https://cdn.example/b.woff2')
    expect(result).toContain('data:font/woff2;base64,OK')
  })

  it('keeps one modern KaTeX font source instead of embedding three formats', () => {
    expect(
      preferWoff2FontSources(
        '@font-face{src:url(a.woff2) format("woff2"),url(a.woff) format("woff"),url(a.ttf) format("truetype");font-family:A}',
      ),
    ).toBe('@font-face{src:url(a.woff2) format("woff2");font-family:A}')
  })

  it('preserves nested heading markup in the deterministic source render', () => {
    const html = renderMarkdownSource('# [Docs](https://example.com) and **bold** $x^2$')
    expect(html).toContain('<a href="https://example.com">')
    expect(html).toContain('<strong>')
    expect(html).toContain('$x^2$')
  })
})
