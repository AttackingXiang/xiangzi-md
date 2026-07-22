import { describe, expect, it, vi } from 'vitest'
import { prepareMarkdownForDocx } from './docxMermaid'

describe('Word Mermaid preprocessing', () => {
  it('replaces backtick and tilde Mermaid fences with rendered PNG images', async () => {
    const render = vi.fn((source: string) =>
      Promise.resolve(`data:image/png;base64,${source.length}`),
    )
    const markdown = [
      '# Diagram',
      '```mermaid title="flow"',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '~~~MERMAID',
      'sequenceDiagram',
      '~~~',
      '',
    ].join('\n')

    await expect(prepareMarkdownForDocx(markdown, render)).resolves.toBe(
      [
        '# Diagram',
        '![Mermaid diagram](data:image/png;base64,22)',
        '',
        '![Mermaid diagram](data:image/png;base64,15)',
        '',
      ].join('\n'),
    )
    expect(render).toHaveBeenNthCalledWith(1, 'flowchart LR\n  A --> B')
    expect(render).toHaveBeenNthCalledWith(2, 'sequenceDiagram')
  })

  it('preserves ordinary and unclosed code fences byte-for-byte', async () => {
    const render = vi.fn()
    const markdown = '```ts\r\nconst value = 1\r\n```\r\n```mermaid\r\ngraph LR'

    await expect(prepareMarkdownForDocx(markdown, render)).resolves.toBe(markdown)
    expect(render).not.toHaveBeenCalled()
  })

  it('supports a closing fence longer than its opening fence', async () => {
    const render = vi.fn(() => Promise.resolve('data:image/png;base64,ok'))

    await expect(prepareMarkdownForDocx('```mermaid\ngraph LR\n````\nnext', render)).resolves.toBe(
      '![Mermaid diagram](data:image/png;base64,ok)\nnext',
    )
  })
})
