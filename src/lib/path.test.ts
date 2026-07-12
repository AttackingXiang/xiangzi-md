import { describe, expect, it } from 'vitest'
import { baseName, dirName, stripExtension } from './path'

describe('path helpers', () => {
  it('extracts the file name across POSIX and Windows separators', () => {
    expect(baseName('/notes/guide.md')).toBe('guide.md')
    expect(baseName('C:\\notes\\guide.md')).toBe('guide.md')
    expect(baseName('guide.md')).toBe('guide.md')
  })

  it('extracts the parent directory, handling roots', () => {
    expect(dirName('/notes/guide.md')).toBe('/notes')
    expect(dirName('/guide.md')).toBe('/')
    expect(dirName('C:\\notes\\guide.md')).toBe('C:\\notes')
    expect(dirName(null)).toBeNull()
  })

  it('strips the extension for display, leaving hidden files untouched', () => {
    expect(stripExtension('guide.md')).toBe('guide')
    expect(stripExtension('archive.tar.gz')).toBe('archive.tar')
    expect(stripExtension('未命名')).toBe('未命名')
    expect(stripExtension('.gitignore')).toBe('.gitignore')
  })
})
