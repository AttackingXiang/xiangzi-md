import { describe, expect, it } from 'vitest'
import { EXPORT_CODE_STYLES, highlightCodeForExport } from './exportSyntax'

describe('highlightCodeForExport', () => {
  it('overrides Crepe inline-code color for plain exported code blocks', () => {
    expect(EXPORT_CODE_STYLES).toContain('color:inherit!important')
  })

  it('renders TypeScript with stable token classes and preserves plain identifiers', async () => {
    const html = await highlightCodeForExport(
      'interface User { name: string }\nconst greet = (user: User) => user.name',
      'ts',
    )

    expect(html).toContain('tok-keyword')
    expect(html).toContain('tok-typeName')
    expect(html).toContain('User')
    expect(html).toContain('greet')
  })

  it.each(['text', 'plaintext', 'unknown-xmd'])(
    'escapes %s code without assigning a misleading color',
    async (language) => {
      await expect(highlightCodeForExport('<plain & text>', language)).resolves.toBe(
        '&lt;plain &amp; text&gt;',
      )
    },
  )
})
