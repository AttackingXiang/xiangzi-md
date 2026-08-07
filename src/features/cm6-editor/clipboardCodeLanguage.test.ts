import { describe, expect, it } from 'vitest'
import { detectClipboardCodeLanguage } from './clipboardCodeLanguage'

function fromHtml(html: string): string | null {
  return detectClipboardCodeLanguage({ html })?.value ?? null
}

describe('clipboard code language', () => {
  it('reads the mode VS Code puts on the clipboard', () => {
    const editorData =
      '{"version":1,"isFromEmptySelection":false,"multicursorText":null,"mode":"typescriptreact"}'
    expect(detectClipboardCodeLanguage({ editorData })?.value).toBe('tsx')
    expect(detectClipboardCodeLanguage({ editorData: '{"mode":"shellscript"}' })?.value).toBe(
      'shell',
    )
    expect(detectClipboardCodeLanguage({ editorData: '{"mode":"csharp"}' })?.value).toBe('c#')
  })

  it('ignores clipboard data that names no real language', () => {
    expect(detectClipboardCodeLanguage({ editorData: '{"mode":"plaintext"}' })).toBeNull()
    expect(detectClipboardCodeLanguage({ editorData: 'not json' })).toBeNull()
    expect(detectClipboardCodeLanguage({ editorData: '{"version":1}' })).toBeNull()
    expect(detectClipboardCodeLanguage({})).toBeNull()
  })

  it('reads Prism and highlight.js class names', () => {
    expect(fromHtml('<pre class="language-rust"><code>fn main() {}</code></pre>')).toBe('rust')
    expect(fromHtml('<pre><code class="lang-py">x = 1</code></pre>')).toBe('python')
    expect(fromHtml('<pre><code class="hljs go">package main</code></pre>')).toBe('go')
    expect(fromHtml('<code class="hljs language-c++">int main()</code>')).toBe('c++')
  })

  it('reads the GitHub blob and rendered-Markdown markers', () => {
    expect(
      fromHtml('<table class="highlight tab-size" data-tagsearch-lang="TypeScript"><tr></tr></table>'), // prettier-ignore
    ).toBe('typescript')
    expect(fromHtml('<div class="highlight highlight-source-shell"><pre>ls -la</pre></div>')).toBe(
      'shell',
    )
  })

  it('reads a pre lang attribute', () => {
    expect(fromHtml('<pre lang="yaml">name: CI</pre>')).toBe('yaml')
  })

  it('returns nothing for unlabelled or meaningless markup', () => {
    expect(fromHtml('<pre><code class="hljs">some text</code></pre>')).toBeNull()
    expect(fromHtml('<pre><code class="language-plaintext">note</code></pre>')).toBeNull()
    expect(fromHtml('<div class="language-notarealthing">x</div>')).toBeNull()
    expect(fromHtml('<p>Just some copied prose.</p>')).toBeNull()
    expect(fromHtml('')).toBeNull()
  })

  it('prefers the editor mode over the markup', () => {
    expect(
      detectClipboardCodeLanguage({
        editorData: '{"mode":"python"}',
        html: '<pre class="language-javascript">x</pre>',
      })?.value,
    ).toBe('python')
  })
})
