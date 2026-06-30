import { describe, expect, it } from 'vitest'
import { localImagePath, replaceClipboardImagePlaceholders } from './richClipboard'

describe('richClipboard', () => {
  it('embeds every copied image instead of leaving a local path', () => {
    const html = '<p>before<img src="xmd-copy-image-0">middle<img src="xmd-copy-image-1">after</p>'
    expect(
      replaceClipboardImagePlaceholders(html, [
        'data:image/png;base64,AAAA',
        'data:image/jpeg;base64,BBBB',
      ]),
    ).toBe(
      '<p>before<img src="data:image/png;base64,AAAA">middle<img src="data:image/jpeg;base64,BBBB">after</p>',
    )
  })

  it('leaves unrelated HTML unchanged', () => {
    expect(replaceClipboardImagePlaceholders('<p>text only</p>', [])).toBe('<p>text only</p>')
  })

  it('decodes macOS and Windows paths from the xmd protocol', () => {
    expect(localImagePath('xmd://localhost/%2FVolumes%2FNotes%2Fimage.png')).toBe(
      '/Volumes/Notes/image.png',
    )
    expect(localImagePath('xmd://localhost/C%3A%5CNotes%5Cimage.png')).toBe('C:\\Notes\\image.png')
  })

  it('does not treat remote images as local files', () => {
    expect(localImagePath('https://example.com/image.png')).toBeNull()
  })
})
