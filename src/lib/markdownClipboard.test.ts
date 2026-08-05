import { describe, expect, it } from 'vitest'
import { markdownToPortableHtml } from './markdownClipboard'
import { DEFAULT_CLIPBOARD_FORMATTING } from './clipboardFormatting'

describe('markdownToPortableHtml', () => {
  it('serializes a complete GFM document without relying on rendered DOM', () => {
    const html = markdownToPortableHtml(
      `# Heading **bold** *italic* ~~deleted~~

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

---`,
      DEFAULT_CLIPBOARD_FORMATTING,
    )

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
    const html = markdownToPortableHtml(
      '<script>alert(1)</script> [bad](javascript:alert(1))',
      DEFAULT_CLIPBOARD_FORMATTING,
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })

  it('omits inline color and highlighter tags by default, with opt-in rich formatting', () => {
    const source =
      '<font color="#dc2626">red</font> and <mark style="background-color:#fde047">marked</mark>'
    const plainRichHtml = markdownToPortableHtml(source, DEFAULT_CLIPBOARD_FORMATTING)
    expect(plainRichHtml).not.toContain('<font')
    expect(plainRichHtml).not.toContain('<mark')
    expect(plainRichHtml).toContain('red')
    expect(plainRichHtml).toContain('marked')

    const formattedRichHtml = markdownToPortableHtml(source, {
      copyTextColor: true,
      copyHighlightColor: true,
    })
    expect(formattedRichHtml).toContain('<font color="#dc2626">red</font>')
    expect(formattedRichHtml).toContain('<mark style="background-color:#fde047">marked</mark>')
  })

  it('handles multiline color and highlighter HTML blocks', () => {
    const source = '<font color="#dc2626">\nred\n</font>\n\n<mark>\nmarked\n</mark>'
    const withoutFormatting = markdownToPortableHtml(source, DEFAULT_CLIPBOARD_FORMATTING)
    expect(withoutFormatting).not.toContain('&lt;font')
    expect(withoutFormatting).not.toContain('&lt;mark')
    expect(withoutFormatting).toContain('red')
    expect(withoutFormatting).toContain('marked')

    const withFormatting = markdownToPortableHtml(source, {
      copyTextColor: true,
      copyHighlightColor: true,
    })
    expect(withFormatting).toContain('<font color="#dc2626">')
    expect(withFormatting).toContain('<mark>')
  })

  it('marks only Mermaid fences for clipboard image completion', () => {
    const html = markdownToPortableHtml(
      `\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`ts
const value = 1
\`\`\``,
      DEFAULT_CLIPBOARD_FORMATTING,
    )

    expect(html.match(/data-xmd-mermaid-block/g)).toHaveLength(1)
    expect(html).toContain('<code>flowchart LR')
    expect(html).toContain('<code>const value = 1</code>')
  })
})
