import { expect, test, type Page } from '@playwright/test'
import type * as PortableClipboardModule from '../src/lib/portableClipboard'
import { openNewDocument } from './helpers'

interface CapturedClipboard {
  types: string[]
  html: string
  text: string
}

type AsyncClipboardWrite = CapturedClipboard

async function trackAsyncClipboardWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __asyncClipboardWrites: AsyncClipboardWrite[] }
    state.__asyncClipboardWrites = []
    if (!navigator.clipboard) return
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: (items: ClipboardItem[]) => {
        return Promise.all(
          items.map(async (item) => ({
            types: [...item.types],
            html: item.types.includes('text/html')
              ? await (await item.getType('text/html')).text()
              : '',
            text: item.types.includes('text/plain')
              ? await (await item.getType('text/plain')).text()
              : '',
          })),
        ).then((writes) => state.__asyncClipboardWrites.push(...writes))
      },
    })
  })
}

async function asyncClipboardWrites(page: Page): Promise<AsyncClipboardWrite[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __asyncClipboardWrites: AsyncClipboardWrite[] })
        .__asyncClipboardWrites,
  )
}

async function enableSourceMode(page: Page): Promise<void> {
  const toggle = page.locator('button[title^="源码模式"]')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const editor = page.getByRole('textbox', { name: 'Markdown editor' })
  await editor.click()
  await expect(editor).toBeFocused()
}

async function openSavedPreviewDocument(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.recent-item', { hasText: '渲染示例.md' }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown editor' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Markdown editor' }).click()
}

async function copySelectedContent(page: Page): Promise<CapturedClipboard> {
  await page.evaluate(() => {
    document.addEventListener(
      'copy',
      (event) => {
        ;(window as unknown as { __capturedClipboard?: CapturedClipboard }).__capturedClipboard = {
          types: Array.from(event.clipboardData?.types ?? []),
          html: event.clipboardData?.getData('text/html') ?? '',
          text: event.clipboardData?.getData('text/plain') ?? '',
        }
      },
      { capture: true, once: true },
    )
  })
  await page.keyboard.press('ControlOrMeta+c')
  return page.evaluate(
    () => (window as unknown as { __capturedClipboard: CapturedClipboard }).__capturedClipboard,
  )
}

test('materializes editor-only classes as portable semantic HTML', async ({ page }) => {
  await page.goto('/')
  const html = await page.evaluate(async () => {
    const modulePath = '/src/lib/portableClipboard.ts'
    const { materializePortableClipboard } = (await import(
      modulePath
    )) as typeof PortableClipboardModule
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="cm-line xmd-cm-heading xmd-cm-heading-2">Heading</div>
      <div class="cm-line xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last">
        <span class="xmd-cm-strong">bold</span>
        <span class="xmd-cm-emphasis">italic</span>
        <span class="xmd-cm-link" data-xmd-href="https://example.com">link</span>
      </div>
      <div class="cm-line xmd-cm-list-line"><span class="xmd-cm-list-marker">•</span>one</div>
      <div class="cm-line xmd-cm-list-line"><span class="xmd-cm-list-marker">•</span>two</div>
      <div class="cm-line xmd-cm-code-fence-line"></div>
      <div class="cm-line xmd-cm-code-line">const value = 1</div>
      <div class="cm-line xmd-cm-code-fence-line"></div>
    `
    materializePortableClipboard(root)
    return root.innerHTML
  })

  expect(html).toContain('<h2')
  expect(html).toContain('<strong>bold</strong>')
  expect(html).toContain('<em>italic</em>')
  expect(html).toContain('<a href="https://example.com">link</a>')
  expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
  expect(html).toContain('<pre')
  expect(html).toContain('<code>const value = 1</code>')
  expect(html).not.toContain('xmd-cm-heading')
})

test('plain mode writes only text/plain while rich mode includes HTML', async ({ page }) => {
  await openNewDocument(page)
  await page.keyboard.type('**portable**')
  await expect(page.locator('.xmd-cm-strong', { hasText: 'portable' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+a')
  const rich = await copySelectedContent(page)

  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: '编辑器', exact: true }).click()
  await page
    .locator('.settings-row', { hasText: '默认复制格式' })
    .locator('select')
    .selectOption('plain')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await page.getByRole('textbox', { name: 'Markdown editor' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  const plain = await copySelectedContent(page)

  expect(rich.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']))
  expect(rich.html).toContain('<strong>portable</strong>')
  expect(rich.text).toBe('portable')
  expect(plain.types).toEqual(['text/plain'])
  expect(plain.html).toBe('')
  expect(plain.text).toBe('portable')
})

test('select-all synchronously includes formatted content outside the CM6 viewport', async ({
  page,
}) => {
  await openNewDocument(page)
  const middle = Array.from({ length: 300 }, (_, index) => `paragraph ${index}`).join('\n\n')
  await page.keyboard.insertText(`# First **start**\n\n${middle}\n\n## Last **finish**`)

  // Inserting leaves the caret at the end, so the opening heading is outside
  // CM6's materialized viewport when copy fires.
  await expect(page.locator('.cm-line', { hasText: 'First start' })).toHaveCount(0)
  await trackAsyncClipboardWrites(page)
  await page.keyboard.press('ControlOrMeta+a')
  const payload = await copySelectedContent(page)

  expect(payload.html).toContain('<h1')
  expect(payload.html).toContain('First <strong>start</strong>')
  expect(payload.html).toContain('<h2')
  expect(payload.html).toContain('Last <strong>finish</strong>')
  expect(payload.text).toContain('paragraph 0')
  expect(payload.text).toContain('paragraph 299')

  // A later viewport-DOM rewrite used to replace this complete payload with
  // only partially decorated HTML after the native copy event had finished.
  await page.waitForTimeout(250)
  await expect.poll(async () => (await asyncClipboardWrites(page)).length).toBe(0)
})

test('select-all resolves and embeds relative local images without using rendered DOM', async ({
  page,
}) => {
  await openSavedPreviewDocument(page)
  await enableSourceMode(page)
  await page.evaluate(async () => {
    const modulePath = '/src/platform/index.ts'
    const { desktop } = (await import(modulePath)) as {
      desktop: { readBinaryFile(path: string): Promise<Uint8Array> }
    }
    const encoded =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const state = window as unknown as { __readClipboardImagePaths: string[] }
    state.__readClipboardImagePaths = []
    desktop.readBinaryFile = (path) => {
      state.__readClipboardImagePaths.push(path)
      return Promise.resolve(bytes)
    }
  })
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('# Image\n\n![pixel](images/pixel.png)')
  await trackAsyncClipboardWrites(page)

  await page.keyboard.press('ControlOrMeta+a')
  const payload = await copySelectedContent(page)

  expect(payload.html).not.toContain('src="images/pixel.png"')
  await expect.poll(async () => (await asyncClipboardWrites(page)).length).toBe(1)
  const completed = (await asyncClipboardWrites(page))[0]
  expect(completed.html).toContain('<h1')
  expect(completed.html).toContain('Image</h1>')
  expect(completed.html).toContain('src="data:image/png;base64,')
  expect(completed.html).toContain('alt="pixel"')
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __readClipboardImagePaths: string[] }).__readClipboardImagePaths,
    ),
  ).toContain('/browser-preview/images/pixel.png')
})

test('select-all honors Mermaid image and source copy modes', async ({ page }) => {
  await openNewDocument(page)
  await enableSourceMode(page)
  await page.keyboard.insertText('```mermaid\nflowchart LR\n  A --> B\n```')
  await trackAsyncClipboardWrites(page)

  await page.keyboard.press('ControlOrMeta+a')
  const initialPayload = await copySelectedContent(page)

  expect(initialPayload.html).toContain('<img')
  expect(initialPayload.html).not.toContain('flowchart LR')
  await expect
    .poll(async () => (await asyncClipboardWrites(page)).length, { timeout: 15_000 })
    .toBe(1)
  const imageWrite = (await asyncClipboardWrites(page))[0]
  expect(imageWrite.html).toContain('src="data:image/png;base64,')
  expect(imageWrite.html).not.toContain('flowchart LR')

  await page.evaluate(async () => {
    const modulePath = '/src/lib/copyPreferences.ts'
    const { setCopyPreferences } = (await import(modulePath)) as {
      setCopyPreferences: (preferences: { mermaidCopyMode: 'source' }) => void
    }
    setCopyPreferences({ mermaidCopyMode: 'source' })
  })
  await trackAsyncClipboardWrites(page)
  await page.keyboard.press('ControlOrMeta+a')
  const sourcePayload = await copySelectedContent(page)

  expect(sourcePayload.html).toContain('<pre')
  expect(sourcePayload.html).toContain('flowchart LR')
  expect(sourcePayload.html).not.toContain('data-xmd-mermaid-block')
  await page.waitForTimeout(250)
  expect(await asyncClipboardWrites(page)).toHaveLength(0)
})

test('plain select-all does not resolve image or Mermaid resources', async ({ page }) => {
  await openSavedPreviewDocument(page)
  await enableSourceMode(page)
  const mermaidRuntimeRequests: string[] = []
  page.on('request', (request) => {
    if (/\/node_modules\/\.vite\/deps\/mermaid\.js(?:\?|$)/.test(request.url())) {
      mermaidRuntimeRequests.push(request.url())
    }
  })
  await page.evaluate(async () => {
    const platformPath = '/src/platform/index.ts'
    const preferencesPath = '/src/lib/copyPreferences.ts'
    const { desktop } = (await import(platformPath)) as {
      desktop: { readBinaryFile(path: string): Promise<Uint8Array> }
    }
    const { setCopyPreferences } = (await import(preferencesPath)) as {
      setCopyPreferences: (preferences: { clipboardFormat: 'plain' }) => void
    }
    const state = window as unknown as { __plainClipboardImageReads: number }
    state.__plainClipboardImageReads = 0
    desktop.readBinaryFile = () => {
      state.__plainClipboardImageReads += 1
      return Promise.resolve(new Uint8Array())
    }
    setCopyPreferences({ clipboardFormat: 'plain' })
  })
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    '![pixel](images/pixel.png)\n\n```mermaid\nflowchart LR\n  A --> B\n```',
  )
  await trackAsyncClipboardWrites(page)

  await page.keyboard.press('ControlOrMeta+a')
  const payload = await copySelectedContent(page)

  expect(payload.types).toEqual(['text/plain'])
  expect(payload.text).toContain('pixel')
  expect(payload.text).toContain('flowchart LR')
  await page.waitForTimeout(250)
  expect(await asyncClipboardWrites(page)).toHaveLength(0)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __plainClipboardImageReads: number }).__plainClipboardImageReads,
    ),
  ).toBe(0)
  expect(mermaidRuntimeRequests).toHaveLength(0)
})
