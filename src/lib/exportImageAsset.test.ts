import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ownedExportObjectUrls,
  releaseExportObjectUrls,
  withOwnedExportObjectUrls,
} from './exportImageAsset'

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

  it('releases partially-created URLs when export assembly fails', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:partial-a')
      .mockReturnValueOnce('blob:partial-b')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(
      withOwnedExportObjectUrls((own) => {
        own(new Blob(['a']))
        own(new Blob(['b']))
        return Promise.reject(new Error('render failed'))
      }),
    ).rejects.toThrow('render failed')

    expect(create).toHaveBeenCalledTimes(2)
    expect(revoke.mock.calls).toEqual([['blob:partial-a'], ['blob:partial-b']])
  })

  it('transfers successful URL ownership to the serialized export', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:complete')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(
      withOwnedExportObjectUrls((own) => Promise.resolve(`<img src="${own(new Blob(['ok']))}">`)),
    ).resolves.toContain('blob:complete')
    expect(revoke).not.toHaveBeenCalled()
  })

  it('releases URLs when an export is cancelled after preparing assets', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:cancelled')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(
      withOwnedExportObjectUrls((own) => {
        own(new Blob(['unused']))
        return Promise.resolve(null)
      }),
    ).resolves.toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:cancelled')
  })
})
