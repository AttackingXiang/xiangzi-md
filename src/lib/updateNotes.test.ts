import { describe, expect, it } from 'vitest'
import { extractUpdateHighlights } from './updateNotes'

describe('extractUpdateHighlights', () => {
  it('returns only user-facing bullets from the update section', () => {
    expect(
      extractUpdateHighlights(`
Xiangzi MD desktop release.

## 本次更新
- 单击图片只选中，双击才放大
- 更新窗口展示 **新版功能**

## 下载说明
- macOS Universal DMG
`),
    ).toEqual(['单击图片只选中，双击才放大', '更新窗口展示 新版功能'])
  })

  it('supports English notes and removes simple inline markdown', () => {
    expect(
      extractUpdateHighlights(
        "### What's new\n- Open `images` with a double-click\n- [Faster export](https://example.com)",
      ),
    ).toEqual(['Open images with a double-click', 'Faster export'])
  })

  it('hides legacy technical release text without an update section', () => {
    expect(extractUpdateHighlights('- Signed package\n- Windows x64 installer')).toEqual([])
  })
})
