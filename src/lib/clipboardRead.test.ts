import { afterEach, describe, expect, it, vi } from 'vitest'
import { readClipboard } from './clipboardRead'

const readClipboardTextMock = vi.hoisted(() => vi.fn())
vi.mock('../platform', () => ({ desktop: { readClipboardText: readClipboardTextMock } }))

function stubNavigatorClipboard(clipboard: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard },
  })
}

function clipboardItem(types: Record<string, string>): {
  types: string[]
  getType: (type: string) => Promise<{ text: () => Promise<string> }>
} {
  return {
    types: Object.keys(types),
    getType: (type: string) => Promise.resolve({ text: () => Promise.resolve(types[type] ?? '') }),
  }
}

afterEach(() => {
  vi.resetAllMocks()
  Reflect.deleteProperty(globalThis, 'navigator')
})

describe('readClipboard', () => {
  it('prefers the HTML flavour when the WebView allows reading it', async () => {
    stubNavigatorClipboard({
      read: () =>
        Promise.resolve([clipboardItem({ 'text/html': '<p>rich</p>', 'text/plain': 'rich' })]),
    })

    await expect(readClipboard()).resolves.toEqual({ html: '<p>rich</p>', text: 'rich' })
    expect(readClipboardTextMock).not.toHaveBeenCalled()
  })

  it('falls back to the native plain-text read when the Web API is denied', async () => {
    // WKWebView 会因为缺少用户手势直接拒绝 read()，此时 Tauri 插件是唯一可靠来源。
    stubNavigatorClipboard({ read: () => Promise.reject(new Error('NotAllowedError')) })
    readClipboardTextMock.mockResolvedValueOnce('/notes/a.md')

    await expect(readClipboard()).resolves.toEqual({ html: null, text: '/notes/a.md' })
  })

  it('falls back again to the Web readText when the native read fails', async () => {
    stubNavigatorClipboard({
      read: () => Promise.reject(new Error('unsupported')),
      readText: () => Promise.resolve('plain'),
    })
    readClipboardTextMock.mockRejectedValueOnce(new Error('no native clipboard'))

    await expect(readClipboard()).resolves.toEqual({ html: null, text: 'plain' })
  })

  it('reports an empty clipboard as null rather than an empty paste', async () => {
    stubNavigatorClipboard({ read: () => Promise.resolve([]) })
    readClipboardTextMock.mockResolvedValueOnce('')

    await expect(readClipboard()).resolves.toBeNull()
  })
})
