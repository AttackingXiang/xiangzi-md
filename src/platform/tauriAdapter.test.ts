import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { writeHtml, writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { open, save } from '@tauri-apps/plugin-dialog'
import { watch } from '@tauri-apps/plugin-fs'
import { check } from '@tauri-apps/plugin-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDocumentPdf } from '../lib/exportDocument'
import { tauriDesktopAdapter, tauriUpdaterAdapter } from './tauriAdapter'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
const { imageFromBytesMock } = vi.hoisted(() => ({ imageFromBytesMock: vi.fn() }))

vi.mock('@tauri-apps/api/image', () => ({ Image: { fromBytes: imageFromBytesMock } }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeHtml: vi.fn(),
  writeImage: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ watch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('../lib/exportDocument', () => ({
  renderDocumentPdf: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)
const writeHtmlMock = vi.mocked(writeHtml)
const writeImageMock = vi.mocked(writeImage)
const openMock = vi.mocked(open)
const saveMock = vi.mocked(save)
const watchMock = vi.mocked(watch)
const checkMock = vi.mocked(check)
const renderDocumentPdfMock = vi.mocked(renderDocumentPdf)

describe('tauriDesktopAdapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    imageFromBytesMock.mockReset()
    writeHtmlMock.mockReset()
    writeImageMock.mockReset()
    openMock.mockReset()
    saveMock.mockReset()
    watchMock.mockReset()
    renderDocumentPdfMock.mockReset()
    checkMock.mockReset()
  })

  it('maps file reads to the stable Rust command contract', async () => {
    const file = { path: '/notes/a.md', name: 'a.md', content: '# A' }
    invokeMock.mockResolvedValueOnce(file)

    await expect(tauriDesktopAdapter.readFile(file.path)).resolves.toEqual(file)
    expect(invokeMock).toHaveBeenCalledWith('read_file', { path: file.path })
  })

  it('watches paths with debounce while ignoring read-access feedback events', async () => {
    const stop = vi.fn()
    let callback: Parameters<typeof watch>[1] | undefined
    watchMock.mockImplementationOnce((_paths, cb) => {
      callback = cb
      return Promise.resolve(stop)
    })
    const onChange = vi.fn()

    await expect(
      tauriDesktopAdapter.watchPaths(['/notes'], onChange, { recursive: false, delayMs: 350 }),
    ).resolves.toBe(stop)
    expect(watchMock).toHaveBeenCalledWith(['/notes'], expect.any(Function), {
      recursive: false,
      delayMs: 350,
    })

    callback?.({
      type: { access: { kind: 'open', mode: 'read' } },
      paths: ['/notes/a.md'],
      attrs: {},
    })
    callback?.({
      type: { modify: { kind: 'data', mode: 'content' } },
      paths: ['/notes/a.md'],
      attrs: {},
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ paths: ['/notes/a.md'] })
  })

  it('reads bounded binary files through the Rust command', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    invokeMock.mockResolvedValueOnce(bytes)

    await expect(tauriDesktopAdapter.readBinaryFile('/notes/a.png')).resolves.toEqual(bytes)
    expect(invokeMock).toHaveBeenCalledWith('read_binary_file', {
      path: '/notes/a.png',
      maxBytes: 64 * 1024 * 1024,
    })
  })

  it('authorizes selected folders recursively before loading the workspace tree', async () => {
    const folder = { root: '/notes', name: 'notes', tree: [] }
    openMock.mockResolvedValueOnce('/notes')
    invokeMock.mockResolvedValueOnce(folder)

    await expect(tauriDesktopAdapter.openFolder()).resolves.toEqual(folder)
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false, recursive: true })
    expect(invokeMock).toHaveBeenCalledWith('open_folder_path', { root: '/notes' })
  })

  it('starts folder navigation from the currently opened directory', async () => {
    openMock.mockResolvedValueOnce('/notes/archive')
    invokeMock.mockResolvedValueOnce({ root: '/notes/archive', name: 'archive', tree: [] })

    await tauriDesktopAdapter.openFolder('/notes/current')

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      recursive: true,
      defaultPath: '/notes/current',
    })
    expect(invokeMock).toHaveBeenCalledWith('open_folder_path', { root: '/notes/archive' })
  })

  it('opens the parent folder directly without showing the native picker', async () => {
    invokeMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await tauriDesktopAdapter.openParentFolder('/notes/current')
    await tauriDesktopAdapter.openContainingFolder('/outside/a.md')

    expect(openMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'open_folder_path', { root: '/notes' })
    expect(invokeMock).toHaveBeenCalledWith('open_containing_folder', {
      filePath: '/outside/a.md',
    })
  })

  it('maps bounded draft recovery operations to Rust commands', async () => {
    invokeMock.mockResolvedValue(undefined)

    await tauriDesktopAdapter.listDrafts()
    await tauriDesktopAdapter.readDraft('tab-1')
    await tauriDesktopAdapter.saveDraft('tab-1', '/notes/a.md', 'a.md', 'draft')
    await tauriDesktopAdapter.deleteDraft('tab-1')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_drafts')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'read_draft', { id: 'tab-1' })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'save_draft', {
      id: 'tab-1',
      path: '/notes/a.md',
      name: 'a.md',
      content: 'draft',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'delete_draft', { id: 'tab-1' })
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

  it('sends attachment bytes as a raw IPC body with metadata in a header', async () => {
    invokeMock.mockResolvedValueOnce({ relPath: 'assets/demo.png' })
    const data = new Uint8Array([1, 2, 3])

    await tauriDesktopAdapter.saveAttachment('/notes', 'a.md', '/notes', 'demo.png', data)

    expect(invokeMock).toHaveBeenCalledWith('save_attachment', data, {
      headers: {
        'x-xmd-attachment': encodeURIComponent(
          JSON.stringify({
            docDir: '/notes',
            docName: 'a.md',
            vaultRoot: '/notes',
            fileName: 'demo.png',
          }),
        ),
      },
    })
  })

  it('cancels an active folder search through the Rust command contract', async () => {
    invokeMock.mockResolvedValueOnce(undefined)

    await tauriDesktopAdapter.cancelSearch()

    expect(invokeMock).toHaveBeenCalledWith('cancel_search')
  })

  it('writes rich HTML and PNG images through the native clipboard', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const image = { close }
    imageFromBytesMock.mockResolvedValueOnce(image)

    await tauriDesktopAdapter.writeClipboardHtml('<p>A</p>', 'A')
    await tauriDesktopAdapter.writeClipboardImage(new Uint8Array([137, 80, 78, 71]))

    expect(writeHtmlMock).toHaveBeenCalledWith('<p>A</p>', 'A')
    expect(imageFromBytesMock).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]))
    expect(writeImageMock).toHaveBeenCalledWith(image)
    expect(close).toHaveBeenCalledOnce()
  })

  it('renders and writes PDF bytes only after the user chooses a destination', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    saveMock.mockResolvedValueOnce('/notes/a.pdf')
    renderDocumentPdfMock.mockResolvedValueOnce(bytes)

    await expect(tauriDesktopAdapter.exportPDF('<h1>A</h1>', 'a.md')).resolves.toEqual({
      path: '/notes/a.pdf',
    })
    expect(renderDocumentPdfMock).toHaveBeenCalledWith('<h1>A</h1>')
    expect(invokeMock).toHaveBeenCalledWith('write_binary_file', bytes, {
      headers: { 'x-xmd-output-path': encodeURIComponent('/notes/a.pdf') },
    })
  })

  it('writes self-contained HTML as binary so image-heavy exports are not limited to 20 MiB', async () => {
    saveMock.mockResolvedValueOnce('/notes/a.html')
    invokeMock.mockResolvedValueOnce({ path: '/notes/a.html' })

    await expect(tauriDesktopAdapter.exportHTML('<h1>A</h1>', 'a.md')).resolves.toEqual({
      path: '/notes/a.html',
    })
    expect(invokeMock).toHaveBeenCalledWith(
      'write_binary_file',
      new TextEncoder().encode('<h1>A</h1>'),
      {
        headers: { 'x-xmd-output-path': encodeURIComponent('/notes/a.html') },
      },
    )
  })

  it('uses clean names for every supported Markdown extension', async () => {
    saveMock.mockResolvedValueOnce(null)

    await tauriDesktopAdapter.exportHTML('<p>A</p>', '说明.markdown')

    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: '说明.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
  })

  it('uses JPEG encoding when the selected image path has a JPEG extension', async () => {
    const chunk = new Uint8Array([255, 0, 0, 255])
    const dispose = vi.fn()
    const onProgress = vi.fn()
    const render = vi.fn().mockResolvedValue({
      width: 1,
      height: 1,
      async *chunks() {
        yield await Promise.resolve(chunk)
      },
      dispose,
    })
    saveMock.mockResolvedValueOnce('/notes/a.jpeg')
    invokeMock.mockImplementation((command) => {
      if (command === 'begin_raster_export') return Promise.resolve('raster-1')
      if (command === 'finish_raster_export') return Promise.resolve({ path: '/notes/a.jpeg' })
      return Promise.resolve(undefined)
    })

    await expect(tauriDesktopAdapter.exportImage('a.md', render, onProgress)).resolves.toEqual({
      path: '/notes/a.jpeg',
    })
    expect(render).toHaveBeenCalledWith('jpeg')
    expect(invokeMock).toHaveBeenCalledWith('begin_raster_export', {
      outputPath: '/notes/a.jpeg',
      width: 1,
      height: 1,
      format: 'jpeg',
    })
    expect(invokeMock).toHaveBeenCalledWith(
      'append_raster_export',
      new Uint8Array([8, ...new TextEncoder().encode('raster-1'), ...chunk]),
    )
    expect(invokeMock).toHaveBeenCalledWith('finish_raster_export', {
      sessionId: 'raster-1',
    })
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: 'preparing' })
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: 'rendering', percent: 0 })
    expect(onProgress).toHaveBeenNthCalledWith(3, { phase: 'rendering', percent: 100 })
    expect(onProgress).toHaveBeenNthCalledWith(4, { phase: 'encoding' })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('cancels the native raster session when image export is aborted', async () => {
    const abortController = new AbortController()
    const chunk = new Uint8Array([255, 0, 0, 255])
    const dispose = vi.fn()
    const render = vi.fn().mockResolvedValue({
      width: 1,
      height: 1,
      async *chunks() {
        yield await Promise.resolve(chunk)
      },
      dispose,
    })
    saveMock.mockResolvedValueOnce('/notes/a.png')
    invokeMock.mockImplementation((command) => {
      if (command === 'begin_raster_export') return Promise.resolve('raster-1')
      if (command === 'append_raster_export') {
        abortController.abort()
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    await expect(
      tauriDesktopAdapter.exportImage('a.md', render, undefined, abortController.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(render).toHaveBeenCalledWith('png', abortController.signal)
    expect(invokeMock).toHaveBeenCalledWith('cancel_raster_export', { sessionId: 'raster-1' })
    expect(invokeMock).not.toHaveBeenCalledWith('finish_raster_export', expect.anything())
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not render a PDF when the save dialog is cancelled', async () => {
    saveMock.mockResolvedValueOnce(null)

    await expect(tauriDesktopAdapter.exportPDF('<p>A</p>', 'a.md')).resolves.toBeNull()
    expect(renderDocumentPdfMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('does not write a PDF when rendering fails', async () => {
    saveMock.mockResolvedValueOnce('/notes/a.pdf')
    renderDocumentPdfMock.mockRejectedValueOnce(new Error('canvas failed'))

    await expect(tauriDesktopAdapter.exportPDF('<p>A</p>', 'a.md')).rejects.toThrow('canvas failed')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('selects Pandoc and Word reference template files', async () => {
    openMock.mockResolvedValueOnce('/opt/homebrew/bin/pandoc')
    openMock.mockResolvedValueOnce('/notes/reference.docx')

    await expect(tauriDesktopAdapter.pickPandocExecutable()).resolves.toEqual({
      path: '/opt/homebrew/bin/pandoc',
    })
    await expect(tauriDesktopAdapter.pickWordTemplate()).resolves.toEqual({
      path: '/notes/reference.docx',
    })
    expect(openMock).toHaveBeenNthCalledWith(1, { multiple: false })
    expect(openMock).toHaveBeenNthCalledWith(2, {
      multiple: false,
      filters: [{ name: 'Word Template', extensions: ['docx'] }],
    })
  })

  it('exports the editable Pandoc default template after choosing a destination', async () => {
    saveMock.mockResolvedValueOnce('/notes/reference.docx')
    invokeMock.mockResolvedValueOnce({ path: '/notes/reference.docx' })

    await expect(tauriDesktopAdapter.savePandocDefaultTemplate()).resolves.toEqual({
      path: '/notes/reference.docx',
    })
    expect(invokeMock).toHaveBeenCalledWith('export_pandoc_default_template', {
      outputPath: '/notes/reference.docx',
    })
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
