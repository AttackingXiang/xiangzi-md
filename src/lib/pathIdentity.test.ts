import { describe, expect, it } from 'vitest'
import {
  documentPathKey,
  documentPathKeyForPlatform,
  isPathAtOrUnder,
  replacePathPrefix,
  sameDocumentPath,
} from './pathIdentity'

describe('path identity', () => {
  it('compares Windows drive and UNC paths case-insensitively without changing display casing', () => {
    expect(sameDocumentPath('C:\\Notes\\File.MD', 'c:/notes/file.md')).toBe(true)
    expect(sameDocumentPath('\\\\Server\\Share\\File.md', '//server/share/file.md')).toBe(true)
    expect(documentPathKey('\\\\Server\\Share\\File.md')).toBe('//server/share/file.md')
  })

  it('keeps POSIX paths case-sensitive and respects path segment boundaries', () => {
    expect(sameDocumentPath('/Notes/File.md', '/notes/file.md')).toBe(false)
    expect(isPathAtOrUnder('/notes/archive/a.md', '/notes')).toBe(true)
    expect(isPathAtOrUnder('/notes-old/a.md', '/notes')).toBe(false)
    expect(isPathAtOrUnder('/notes/a.md', '/')).toBe(true)
    expect(isPathAtOrUnder('C:\\Notes\\a.md', 'c:\\')).toBe(true)
  })

  it('treats // as UNC only on Windows instead of lowercasing POSIX paths', () => {
    expect(documentPathKeyForPlatform('//Volumes/Case/File.md', 'macos')).toBe(
      '//Volumes/Case/File.md',
    )
    expect(documentPathKeyForPlatform('//Server/Share/File.md', 'windows')).toBe(
      '//server/share/file.md',
    )
  })

  it('preserves descendant filename casing when a Windows folder moves', () => {
    expect(
      replacePathPrefix(
        'C:\\Notes\\Work\\FileName.MD',
        'c:\\notes\\work',
        'C:\\Notes\\Archive\\Work',
      ),
    ).toBe('C:\\Notes\\Archive\\Work\\FileName.MD')
  })

  it('joins descendants correctly when either prefix is a filesystem root', () => {
    expect(replacePathPrefix('/notes/a.md', '/', '/archive')).toBe('/archive/notes/a.md')
    expect(replacePathPrefix('C:\\Notes\\a.md', 'c:\\', 'D:\\')).toBe('D:\\Notes\\a.md')
  })
})
