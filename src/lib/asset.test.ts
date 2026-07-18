import { describe, expect, it } from 'vitest'
import {
  BLOCKED_REMOTE_IMAGE,
  blobPartFromBytes,
  imageMimeType,
  imageMimeTypeFromBytes,
  resolveAssetURL,
  xmdAssetPaths,
} from './asset'

describe('xmd assets', () => {
  it('decodes the primary and fallback paths in protocol order', () => {
    const source =
      'xmd://localhost/%2Fmissing%2Fimage.png?alts=' +
      encodeURIComponent('/notes/image.png\n/backup/image.png')

    expect(xmdAssetPaths(source)).toEqual([
      '/missing/image.png',
      '/notes/image.png',
      '/backup/image.png',
    ])
  })

  it('rejects non-xmd URLs and identifies common image MIME types', () => {
    expect(xmdAssetPaths('https://example.com/image.png')).toEqual([])
    expect(imageMimeType('/notes/photo.jpg')).toBe('image/jpeg')
    expect(imageMimeType('C:\\notes\\diagram.svg')).toBe('image/svg+xml')
  })

  it('detects remote image MIME types from payload signatures', () => {
    expect(imageMimeTypeFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe(
      'image/png',
    )
    expect(imageMimeTypeFromBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(imageMimeTypeFromBytes(new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'))).toBe(
      'image/svg+xml',
    )
  })

  it('parses the Windows http://xmd.localhost mapped form', () => {
    // WebView2 不支持自定义 scheme，Tauri 在 Windows 上把 xmd:// 映射为
    // http://xmd.localhost/；解析器必须两种形式都认。
    const source =
      'http://xmd.localhost/C%3A%5Cnotes%5Cimage.png?alts=' +
      encodeURIComponent('C:\\notes\\backup.png')
    expect(xmdAssetPaths(source)).toEqual(['C:\\notes\\image.png', 'C:\\notes\\backup.png'])
    // 已映射的地址再次经过 resolveAssetURL 时应原样放行，而不是被当远程图拦截
    expect(resolveAssetURL('/notes', 'http://xmd.localhost/abc.png')).toBe(
      'http://xmd.localhost/abc.png',
    )
  })

  it('reuses complete ArrayBuffers and trims sliced byte views', () => {
    const full = new Uint8Array([1, 2, 3, 4])
    expect(blobPartFromBytes(full)).toBe(full.buffer)
    expect(new Uint8Array(blobPartFromBytes(full.subarray(1, 3)))).toEqual(new Uint8Array([2, 3]))
  })

  it('passes raw ArrayBuffers through without zero-filling', () => {
    // tauri::ipc::Response 的二进制在前端是 ArrayBuffer；曾经的 TypedArray
    // 分支对它 set() 不拷贝任何字节，产出全零图片导致复制图片静默失败。
    const raw = new Uint8Array([9, 8, 7]).buffer
    expect(blobPartFromBytes(raw)).toBe(raw)
    expect(new Uint8Array(blobPartFromBytes(raw))).toEqual(new Uint8Array([9, 8, 7]))
  })

  it('blocks remote images by default and only permits them after opt-in', () => {
    const remote = 'https://images.example/private.png'
    expect(resolveAssetURL('/notes', remote)).toBe(BLOCKED_REMOTE_IMAGE)
    expect(resolveAssetURL('/notes', remote, null, [], true)).toBe(remote)
  })

  it('tries every ancestor directory between docDir and the vault root', () => {
    // 文档在 vault/科学上网/客户端/，图片实际在 vault/科学上网/assets/…：
    // 相对路径应逐级向上探测，直到仓库根为止。
    const url = resolveAssetURL(
      '/vault/科学上网/客户端',
      'assets/修改sim卡国家码/img.png',
      '/vault',
    )
    const candidates = xmdAssetPaths(url)
    expect(candidates[0]).toBe('/vault/科学上网/客户端/assets/修改sim卡国家码/img.png')
    expect(candidates).toContain('/vault/科学上网/assets/修改sim卡国家码/img.png')
    expect(candidates).toContain('/vault/assets/修改sim卡国家码/img.png')
  })

  it('keeps probing a bounded distance above the vault root', () => {
    // 用户把子文件夹当仓库打开（docDir == vaultRoot）、图片实际在上层目录：
    // 越过仓库根仍要多探几层，否则这类布局全部裂图；安全由协议层授权兜底。
    const url = resolveAssetURL(
      '/note/科学上网/客户端',
      'assets/修改sim卡国家码/img.png',
      '/note/科学上网/客户端',
    )
    const candidates = xmdAssetPaths(url)
    expect(candidates[0]).toBe('/note/科学上网/客户端/assets/修改sim卡国家码/img.png')
    expect(candidates).toContain('/note/科学上网/assets/修改sim卡国家码/img.png')
    expect(candidates).toContain('/note/assets/修改sim卡国家码/img.png')
    // 越根探测有上限（2 层），不会一路爬到根目录
    expect(candidates).not.toContain('/assets/修改sim卡国家码/img.png')
  })

  it('limits ancestor probing when the document is outside any vault', () => {
    const url = resolveAssetURL('/a/b/c/d/e', 'img.png', null)
    const candidates = xmdAssetPaths(url)
    expect(candidates[0]).toBe('/a/b/c/d/e/img.png')
    expect(candidates).toContain('/a/b/c/d/img.png')
    expect(candidates).toContain('/a/b/img.png')
    // 最多向上 3 层，不无限爬到根目录
    expect(candidates).not.toContain('/a/img.png')
  })

  it('adds percent-decoded candidates for encoded relative paths', () => {
    const url = resolveAssetURL('/notes', 'assets/my%20image.png', '/vault')
    const candidates = xmdAssetPaths(url)
    expect(candidates[0]).toBe('/notes/assets/my%20image.png')
    expect(candidates).toContain('/notes/assets/my image.png')
    expect(candidates).toContain('/vault/assets/my image.png')
  })
})
