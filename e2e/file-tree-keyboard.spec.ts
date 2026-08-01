import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Regression suite for the WAI-ARIA tree keyboard navigation added to
 * FileTree.tsx in 09272fa/cfc881b. Zero coverage existed before this file.
 *
 * Fixture note: the browser-preview DesktopPort (src/platform/browserAdapter.ts)
 * backs a genuinely flat workspace — `previewTree()` maps the in-memory `files`
 * Map and hardcodes `isDir: false` on every entry, and `createDir` never adds
 * anything to that Map, so a created "folder" never resurfaces from the
 * `readDir` refresh the app does afterwards. There is no way, through the app's
 * own UI, to get a directory row into the tree in this environment — confirmed
 * by reading browserAdapter.ts and by inspecting the live DOM after using the
 * "新建文件夹" context-menu action. Every directory-specific behaviour from the
 * two commits (ArrowRight expanding/descending, ArrowLeft collapsing, nested
 * role="group", aria-level > 1, aria-busy while loading children) is therefore
 * untestable here; see the two boundary-case assertions below for what the
 * fixture *does* let us pin down about those code paths.
 */

/** Opens the workspace folder from the Welcome screen's empty-sidebar state
 * and waits for the ARIA tree to render its first (only, at this point) row. */
async function openFileTree(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('body')).toHaveClass(/is-browser-preview/)
  await page.locator('.sidebar-empty').getByRole('button', { name: '打开文件夹' }).click()
  await expect(page.getByRole('tree', { name: '文件树' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: '渲染示例.md' })).toBeVisible()
}

/** Creates a new flat file (`${baseName}.md`) via the sidebar's root context
 * menu ("新建文件") and waits for its row to actually render — the dialog
 * closes optimistically before the create + tree-refresh round trip settles
 * (see InputDialog.tsx's submit(), which calls onClose() unconditionally right
 * after firing onSubmit), so waiting on the row rather than the dialog is what
 * avoids a race. Every file this produces is flat under the workspace root:
 * createFile in the browser adapter ignores the target directory. */
async function createFile(page: Page, baseName: string): Promise<void> {
  const sidebarBody = page.locator('.sidebar-body')
  const box = await sidebarBody.boundingBox()
  if (!box) throw new Error('sidebar body has no layout box')
  // Bottom-left corner: empty tree area below any row so far, never landing on
  // an existing .tree-row (which would open that row's own context menu
  // instead of the root one).
  await sidebarBody.click({ position: { x: 20, y: box.height - 16 }, button: 'right' })
  const menu = page.locator('.ctx-menu')
  await menu.getByText('新建文件', { exact: true }).click()
  const input = page.locator('.input-dialog-field')
  await expect(input).toBeFocused()
  await page.keyboard.type(baseName)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('treeitem', { name: `${baseName}.md` })).toBeVisible()
}

/** Every currently-rendered row, in the exact DOM order handleKeyDown's own
 * `querySelectorAll('[role="treeitem"]')` would see — the same order
 * ArrowDown/Up/Home/End walk. */
function treeRows(page: Page): Locator {
  return page.locator('[role="treeitem"]')
}

async function rowNames(page: Page): Promise<string[]> {
  return treeRows(page).evaluateAll((rows) =>
    rows.map((row) => row.querySelector('.tree-name')?.textContent ?? ''),
  )
}

/** {name, tabIndex} for every rendered row — used to assert the roving
 * tabindex invariant (exactly one 0, everyone else -1). */
async function tabIndexEntries(page: Page): Promise<Array<{ name: string; tabIndex: number }>> {
  return treeRows(page).evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('.tree-name')?.textContent ?? '',
      tabIndex: (row as HTMLElement).tabIndex,
    })),
  )
}

/** Name of the row that currently owns DOM focus, or null if focus is
 * elsewhere. Reads document.activeElement directly rather than trusting a
 * locator, since "which exact row" is precisely what these tests must pin. */
async function focusedRowName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el.getAttribute('role') !== 'treeitem') return null
    return el.querySelector('.tree-name')?.textContent ?? null
  })
}

test('tree root and rows expose the WAI-ARIA tree structure', async ({ page }) => {
  await openFileTree(page)

  const tree = page.getByRole('tree', { name: '文件树' })
  await expect(tree).toBeVisible()

  const row = page.getByRole('treeitem', { name: '渲染示例.md' })
  await expect(row).toHaveAttribute('aria-level', '1')
  // Not opened yet — activePath is still null, so this row is not the active file.
  await expect(row).toHaveAttribute('aria-selected', 'false')
  // Sole row, nothing yet focused via keyboard/click: falls back to "first root
  // node" as the one Tab stop (see FileTree.tsx's isRovingTabStop fallback).
  await expect(row).toHaveAttribute('tabindex', '0')
})

test('roving tabindex: exactly one row is a Tab stop, and it follows focus', async ({ page }) => {
  await openFileTree(page)
  await createFile(page, 'alpha')
  await createFile(page, 'bravo')
  await createFile(page, 'charlie')

  const names = await rowNames(page)
  expect(names).toHaveLength(4)
  // Each create also opens the new file, so "charlie.md" (created last) is the
  // active file — and with focusedPath still null, the active file wins the
  // roving tab stop by fallback.
  let entries = await tabIndexEntries(page)
  expect(entries.filter((e) => e.tabIndex === 0)).toEqual([{ name: 'charlie.md', tabIndex: 0 }])
  expect(entries.filter((e) => e.tabIndex !== -1)).toHaveLength(1)

  // Focusing a different row (as a real keyboard/AT user landing on it would)
  // must flip the roving tab stop to that row and nowhere else.
  await page.getByRole('treeitem', { name: 'alpha.md' }).focus()
  entries = await tabIndexEntries(page)
  expect(entries.filter((e) => e.tabIndex === 0)).toEqual([{ name: 'alpha.md', tabIndex: 0 }])
  expect(entries.find((e) => e.name === 'charlie.md')).toEqual({
    name: 'charlie.md',
    tabIndex: -1,
  })
  expect(entries.filter((e) => e.tabIndex !== -1)).toHaveLength(1)
})

test('ArrowDown/ArrowUp move focus to the adjacent visible row', async ({ page }) => {
  await openFileTree(page)
  await createFile(page, 'alpha')
  await createFile(page, 'bravo')
  await createFile(page, 'charlie')

  const names = await rowNames(page)
  expect(names).toHaveLength(4)

  await page.getByRole('treeitem', { name: names[0] }).focus()
  await expect.poll(() => focusedRowName(page)).toBe(names[0])

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => focusedRowName(page)).toBe(names[1])
  let entries = await tabIndexEntries(page)
  expect(entries.find((e) => e.name === names[1])?.tabIndex).toBe(0)
  expect(entries.find((e) => e.name === names[0])?.tabIndex).toBe(-1)

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => focusedRowName(page)).toBe(names[2])

  await page.keyboard.press('ArrowUp')
  await expect.poll(() => focusedRowName(page)).toBe(names[1])
  entries = await tabIndexEntries(page)
  expect(entries.find((e) => e.name === names[1])?.tabIndex).toBe(0)
  expect(entries.find((e) => e.name === names[2])?.tabIndex).toBe(-1)
})

test('Home/End jump to the first and last visible row', async ({ page }) => {
  await openFileTree(page)
  await createFile(page, 'alpha')
  await createFile(page, 'bravo')
  await createFile(page, 'charlie')

  const names = await rowNames(page)
  expect(names).toHaveLength(4)

  // Start in the middle so Home/End are unambiguously "jump", not "no-op".
  await page.getByRole('treeitem', { name: names[1] }).focus()
  await expect.poll(() => focusedRowName(page)).toBe(names[1])

  await page.keyboard.press('Home')
  await expect.poll(() => focusedRowName(page)).toBe(names[0])
  expect((await tabIndexEntries(page)).find((e) => e.name === names[0])?.tabIndex).toBe(0)

  await page.keyboard.press('End')
  await expect.poll(() => focusedRowName(page)).toBe(names[names.length - 1])
  expect(
    (await tabIndexEntries(page)).find((e) => e.name === names[names.length - 1])?.tabIndex,
  ).toBe(0)
})

test('Enter opens the focused file and marks its row aria-selected', async ({ page }) => {
  await openFileTree(page)
  const row = page.getByRole('treeitem', { name: '渲染示例.md' })
  await row.focus()
  await expect(row).toHaveAttribute('aria-selected', 'false')

  await page.keyboard.press('Enter')

  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(row).toHaveAttribute('aria-selected', 'true')
})

test('ArrowRight on a file is a no-op; ArrowLeft on a root file has no parent to reach', async ({
  page,
}) => {
  // Directory expand/collapse/descend can't be exercised in this fixture (see
  // the file-level comment) — these two assertions instead pin the boundary
  // branches handleKeyDown takes for a *file* row at depth 0: ArrowRight bails
  // out immediately because `!node.isDir`, and ArrowLeft's findParentRow()
  // finds no ancestor `ul[role="group"]` (the root list is role="tree", not
  // "group"), so focus has nowhere to go in either case.
  await openFileTree(page)
  const row = page.getByRole('treeitem', { name: '渲染示例.md' })
  await row.focus()
  await expect.poll(() => focusedRowName(page)).toBe('渲染示例.md')

  await page.keyboard.press('ArrowRight')
  await expect.poll(() => focusedRowName(page)).toBe('渲染示例.md')
  await expect(row).toHaveAttribute('tabindex', '0')

  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => focusedRowName(page)).toBe('渲染示例.md')
  await expect(row).toHaveAttribute('tabindex', '0')
})

test('keyboard-driven focus shows a visible focus ring', async ({ page }) => {
  await openFileTree(page)
  await createFile(page, 'alpha')

  const first = page.getByRole('treeitem', { name: 'alpha.md' })
  const second = page.getByRole('treeitem', { name: '渲染示例.md' })
  await first.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => focusedRowName(page)).toBe('渲染示例.md')

  // .tree-row:focus-visible (src/styles/slices/sidebar.css) paints a solid
  // outline; a row that never received focus must not have one.
  const focusedStyle = await second.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }
  })
  expect(focusedStyle.outlineStyle).toBe('solid')
  expect(focusedStyle.outlineWidth).not.toBe('0px')

  const unfocusedStyle = await first.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(unfocusedStyle).not.toBe('solid')
})
