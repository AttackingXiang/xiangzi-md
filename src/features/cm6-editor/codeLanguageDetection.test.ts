import { describe, expect, it } from 'vitest'
import { detectCodeLanguage } from './codeLanguageDetection'

describe('pasted code language detection', () => {
  it('recognizes structured data and common programming languages', () => {
    expect(detectCodeLanguage('{"name":"Xiangzi","enabled":true}')?.value).toBe('json')
    expect(detectCodeLanguage('interface User {\n  name: string\n}')?.value).toBe('typescript')
    expect(detectCodeLanguage('def greet(name):\n    return f"Hello {name}"')?.value).toBe('python')
    expect(detectCodeLanguage('SELECT id, name FROM users WHERE active = 1;')?.value).toBe('sql')
    expect(detectCodeLanguage('sh /app/echn/emallmng/bin/stopBack10088.sh')?.value).toBe('shell')
  })

  it('recognizes markup and nested fenced snippets', () => {
    expect(detectCodeLanguage('<div class="app">Hello</div>')?.value).toBe('html')
    expect(detectCodeLanguage('```rust\nfn main() {}\n```')?.value).toBe('rust')
  })

  it('returns no guess for ordinary text', () => {
    expect(detectCodeLanguage('This is a short note about the project.')).toBeNull()
    expect(detectCodeLanguage('')).toBeNull()
  })
})
