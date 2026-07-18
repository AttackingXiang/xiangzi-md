import { describe, expect, it } from 'vitest'
import { markdownToPortableHtml } from './markdownClipboard'

describe('markdownToPortableHtml', () => {
  it('serializes a complete GFM document without relying on rendered DOM', () => {
    const html = markdownToPortableHtml(`# Heading **bold** *italic* ~~deleted~~

[link](https://example.com) and ![alt](images/a.png)

- item
- [x] done

> quote

\`inline\`

\`\`\`ts
const value = 1
\`\`\`

| A | B |
|---|---|
| x | y |

---`)

    expect(html).toContain('<h1')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<del>deleted</del>')
    expect(html).toContain('<a href="https://example.com">link</a>')
    expect(html).toContain('<img ')
    expect(html).toContain('alt="alt"')
    expect(html).toContain('<ul>')
    expect(html).toContain('☑ done')
    expect(html).toContain('<blockquote')
    expect(html).toContain('<code>inline</code>')
    expect(html).toContain('<pre')
    expect(html).toContain('const value = 1')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('<hr>')
  })

  it('escapes raw markup and rejects executable links', () => {
    const html = markdownToPortableHtml('<script>alert(1)</script> [bad](javascript:alert(1))')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })

  it('marks only Mermaid fences for clipboard image completion', () => {
    const html = markdownToPortableHtml(`\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`ts
const value = 1
\`\`\``)

    expect(html.match(/data-xmd-mermaid-block/g)).toHaveLength(1)
    expect(html).toContain('<code>flowchart LR')
    expect(html).toContain('<code>const value = 1</code>')
  })
})
