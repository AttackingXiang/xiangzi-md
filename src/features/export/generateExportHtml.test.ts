import { describe, expect, it, vi } from 'vitest'
import {
  exportCssAssetMimeType,
  exportHeadingIds,
  inlineExportCssAssets,
  preferWoff2FontSources,
} from './generateExportHtml'

describe('DOM export helpers', () => {
  it('uses standalone-safe MIME types for embedded fonts and images', () => {
    expect(exportCssAssetMimeType('/fonts/KaTeX_Main.woff2?v=1')).toBe('font/woff2')
    expect(exportCssAssetMimeType('/images/background.webp')).toBe('image/webp')
  })

  it('matches editor anchor slugs and suffixes duplicates', () => {
    expect(exportHeadingIds(['Hello, World!', 'Hello World', '中文 标题', '!!!'])).toEqual([
      'hello-world',
      'hello-world-1',
      '中文-标题',
      '',
    ])
  })

  it('inlines only same-origin style assets and de-duplicates loads', async () => {
    const load = vi.fn((url: string) =>
      Promise.resolve(`data:font/woff2;base64,${url.endsWith('a.woff2') ? 'A' : 'B'}`),
    )
    const css = [
      '@font-face{src:url("/assets/a.woff2")}',
      '.again{src:url(/assets/a.woff2)}',
      '.external{src:url(https://cdn.example/b.woff2)}',
      '.inline{src:url(data:font/woff2;base64,OK)}',
    ].join('')

    const result = await inlineExportCssAssets(css, 'https://app.local/document', load)

    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith('https://app.local/assets/a.woff2')
    expect(result.match(/data:font\/woff2;base64,A/g)).toHaveLength(2)
    expect(result).toContain('https://cdn.example/b.woff2')
  })

  it('keeps one modern KaTeX font source instead of embedding three formats', () => {
    expect(
      preferWoff2FontSources(
        '@font-face{src:url(a.woff2) format("woff2"),url(a.woff) format("woff"),url(a.ttf) format("truetype");font-family:A}',
      ),
    ).toBe('@font-face{src:url(a.woff2) format("woff2");font-family:A}')
  })
})
