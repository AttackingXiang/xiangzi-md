import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { check } from '@tauri-apps/plugin-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDocumentImage, renderDocumentPdf } from '../lib/exportDocument'
import { tauriDesktopAdapter, tauriUpdaterAdapter } from './tauriAdapter'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('../lib/exportDocument', () => ({
  imageFormatForPath: vi.fn((path: string) => (/\.jpe?g$/i.test(path) ? 'jpeg' : 'png')),
  renderDocumentImage: vi.fn(),
  renderDocumentPdf: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)
const saveMock = vi.mocked(save)
const writeFileMock = vi.mocked(writeFile)
const checkMock = vi.mocked(check)
const renderDocumentImageMock = vi.mocked(renderDocumentImage)
const renderDocumentPdfMock = vi.mocked(renderDocumentPdf)

describe('tauriDesktopAdapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    saveMock.mockReset()
    writeFileMock.mockReset()
    renderDocumentImageMock.mockReset()
    renderDocumentPdfMock.mockReset()
    checkMock.mockReset()
  })

  it('maps file reads to the stable Rust command contract', async () => {
    const file = { path: '/notes/a.md', name: 'a.md', content: '# A' }
    invokeMock.mockResolvedValueOnce(file)

    await expect(tauriDesktopAdapter.readFile(file.path)).resolves.toEqual(file)
    expect(invokeMock).toHaveBeenCalledWith('read_file', { path: file.path })
  })

  it('declares the frontend ready only after the open-path listener is registered', async () => {
    const unlisten = vi.fn()
    let finishListening: ((stop: () => void) => void) | undefined
    listenMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishListening = resolve
      }) as never,
    )

    const dispose = tauriDesktopAdapter.onOpenPath(vi.fn())
    expect(invokeMock).not.toHaveBeenCalled()

    finishListening?.(unlisten)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('frontend_ready'))

    dispose()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('serializes attachment bytes as a command-safe array', async () => {
    invokeMock.mockResolvedValueOnce({ relPath: 'assets/demo.png' })

    await tauriDesktopAdapter.saveAttachment(
      '/notes',
      'a.md',
      '/notes',
      'demo.png',
      new Uint8Array([1, 2, 3]),
    )

    expect(invokeMock).toHaveBeenCalledWith('save_attachment', {
      docDir: '/notes',
      docName: 'a.md',
      vaultRoot: '/notes',
      fileName: 'demo.png',
      data: [1, 2, 3],
    })
  })

  it('renders and writes PDF bytes only after the user chooses a destination', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    saveMock.mockResolvedValueOnce('/notes/a.pdf')
    renderDocumentPdfMock.mockResolvedValueOnce(bytes)

    await expect(tauriDesktopAdapter.exportPDF('<h1>A</h1>', 'a.md')).resolves.toEqual({
      path: '/notes/a.pdf',
    })
    expect(renderDocumentPdfMock).toHaveBeenCalledWith('<h1>A</h1>')
    expect(writeFileMock).toHaveBeenCalledWith('/notes/a.pdf', bytes)
  })

  it('writes the self-contained HTML through the scoped Rust command', async () => {
    saveMock.mockResolvedValueOnce('/notes/a.html')
    invokeMock.mockResolvedValueOnce({ path: '/notes/a.html' })

    await expect(tauriDesktopAdapter.exportHTML('<h1>A</h1>', 'a.md')).resolves.toEqual({
      path: '/notes/a.html',
    })
    expect(invokeMock).toHaveBeenCalledWith('write_file', {
      path: '/notes/a.html',
      content: '<h1>A</h1>',
    })
  })

  it('uses JPEG encoding when the selected image path has a JPEG extension', async () => {
    const bytes = new Uint8Array([255, 216, 255])
    saveMock.mockResolvedValueOnce('/notes/a.jpeg')
    renderDocumentImageMock.mockResolvedValueOnce(bytes)

    await expect(tauriDesktopAdapter.exportImage('<h1>A</h1>', 'a.md')).resolves.toEqual({
      path: '/notes/a.jpeg',
    })
    expect(renderDocumentImageMock).toHaveBeenCalledWith('<h1>A</h1>', 'jpeg')
    expect(writeFileMock).toHaveBeenCalledWith('/notes/a.jpeg', bytes)
  })

  it('does not render a PDF when the save dialog is cancelled', async () => {
    saveMock.mockResolvedValueOnce(null)

    await expect(tauriDesktopAdapter.exportPDF('<h1>A</h1>', 'a.md')).resolves.toBeNull()
    expect(renderDocumentPdfMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('maps updater metadata without exposing the plugin object to React features', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    checkMock.mockResolvedValueOnce({
      version: '1.2.0',
      currentVersion: '1.1.0',
      body: 'Bug fixes',
      rawJson: { platforms: { darwin: { url: 'https://gitee.com/release.tar.gz' } } },
      close,
      downloadAndInstall,
    } as never)

    const update = await tauriUpdaterAdapter.check(8_000)

    expect(checkMock).toHaveBeenCalledWith({ timeout: 8_000 })
    expect(update).toMatchObject({
      version: '1.2.0',
      currentVersion: '1.1.0',
      notes: 'Bug fixes',
      source: 'gitee',
    })
    await update?.close()
    expect(close).toHaveBeenCalledOnce()
  })
})
