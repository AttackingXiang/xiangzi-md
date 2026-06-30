import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownedExportObjectUrls, releaseExportObjectUrls } from './exportImageAsset'

describe('export image assets', () => {
  afterEach(() => vi.restoreAllMocks())

  it('tracks only object URLs owned by the export document', () => {
    const html = [
      '<img src="blob:http://localhost/live-preview">',
      '<img data-xmd-export-owned-url="blob:http://localhost/export-1">',
      '<img data-xmd-export-owned-url="blob:http://localhost/export-1">',
      '<img data-xmd-export-owned-url="blob:http://localhost/export-2">',
    ].join('')

    expect(ownedExportObjectUrls(html)).toEqual([
      'blob:http://localhost/export-1',
      'blob:http://localhost/export-1',
      'blob:http://localhost/export-2',
    ])
  })

  it('releases each owned object URL once', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    releaseExportObjectUrls(
      '<img data-xmd-export-owned-url="blob:a"><img data-xmd-export-owned-url="blob:a"><img data-xmd-export-owned-url="blob:b">',
    )

    expect(revoke.mock.calls).toEqual([['blob:a'], ['blob:b']])
  })
})
