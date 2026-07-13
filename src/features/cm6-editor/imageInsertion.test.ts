import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parseMarkdownImage } from './imagePreview'
import { isImageFile, mapPendingImageAnchor, markdownImageInsertionText } from './imageInsertion'

describe('CM6 image insertion', () => {
  it('creates safe Markdown image syntax', () => {
    expect(markdownImageInsertionText('示例[1].png', 'assets/my image.png')).toBe(
      '![示例\\[1\\].png](<assets/my image.png>)',
    )
    expect(markdownImageInsertionText('a.png', 'assets/a>b.png')).toBe(
      '![a.png](<assets/a\\>b.png>)',
    )
    expect(markdownImageInsertionText('line\nbreak.png', 'assets/a\nname.png')).toBe(
      '![line break.png](<assets/a%0Aname.png>)',
    )
    expect(parseMarkdownImage(markdownImageInsertionText('a.png', 'assets/a>b.png'))).toEqual({
      alt: 'a.png',
      src: 'assets/a>b.png',
    })
    expect(markdownImageInsertionText('\u0000', 'assets/a.png')).toBe('![image](<assets/a.png>)')
  })

  it('accepts image MIME types and extension fallback without accepting arbitrary files', () => {
    expect(isImageFile({ name: 'clipboard', type: 'image/png' })).toBe(true)
    expect(isImageFile({ name: 'photo.WEBP', type: '' })).toBe(true)
    expect(isImageFile({ name: 'photo.jpg', type: 'application/octet-stream' })).toBe(true)
    expect(isImageFile({ name: 'notes.txt', type: '' })).toBe(false)
    expect(isImageFile({ name: 'fake.png', type: 'text/plain' })).toBe(false)
  })

  it('maps a collapsed upload anchor through edits before it', () => {
    const changes = ChangeSet.of([{ from: 0, insert: '你好' }], 4)
    expect(mapPendingImageAnchor({ id: 1, from: 2, to: 2 }, changes)).toEqual({
      id: 1,
      from: 4,
      to: 4,
    })
  })

  it('maps a selected replacement range through multiple changes', () => {
    const changes = ChangeSet.of(
      [
        { from: 0, insert: 'x' },
        { from: 5, to: 7 },
      ],
      10,
    )
    expect(mapPendingImageAnchor({ id: 2, from: 2, to: 8 }, changes)).toEqual({
      id: 2,
      from: 3,
      to: 7,
    })
  })

  it('keeps an anchor valid when its selected content is deleted', () => {
    const changes = ChangeSet.of([{ from: 1, to: 5 }], 6)
    expect(mapPendingImageAnchor({ id: 3, from: 2, to: 4 }, changes)).toEqual({
      id: 3,
      from: 1,
      to: 1,
    })
  })
})
