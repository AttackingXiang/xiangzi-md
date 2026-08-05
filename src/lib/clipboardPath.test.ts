import { describe, expect, it } from 'vitest'
import { clipboardPath } from './clipboardPath'

describe('clipboardPath', () => {
  it('accepts absolute POSIX and Windows paths', () => {
    expect(clipboardPath('/Users/me/Notes/a.md')).toBe('/Users/me/Notes/a.md')
    expect(clipboardPath('C:\\Users\\me\\Notes\\a.md')).toBe('C:\\Users\\me\\Notes\\a.md')
    expect(clipboardPath('\\\\server\\share\\Notes')).toBe('\\\\server\\share\\Notes')
  })

  it('decodes local file URLs', () => {
    expect(clipboardPath('file:///Users/me/My%20Notes/a.md')).toBe('/Users/me/My Notes/a.md')
  })

  it('only turns a network file URL into a UNC path on Windows', () => {
    expect(clipboardPath('file://server/share/My%20Notes', 'windows')).toBe(
      '\\\\server\\share\\My Notes',
    )
    expect(clipboardPath('file://server/share/My%20Notes', 'macos')).toBeNull()
    expect(clipboardPath('file://server/share/My%20Notes', 'linux')).toBeNull()
  })

  it('allows surrounding quotes and trailing newlines', () => {
    expect(clipboardPath('"/Users/me/My Notes/a.md"\n')).toBe('/Users/me/My Notes/a.md')
  })

  it('rejects URLs, relative paths, and multi-line text', () => {
    expect(clipboardPath('https://example.com/a.md')).toBeNull()
    expect(clipboardPath('./notes/a.md')).toBeNull()
    expect(clipboardPath('标题\n/Users/me/a.md')).toBeNull()
  })
})
