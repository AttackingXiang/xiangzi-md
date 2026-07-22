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

  it('collects bullets under nested release-note headings', () => {
    expect(
      extractUpdateHighlights(`
## 本次更新

### 改进
- 普通回车只换一行

### 修复
- 更新弹窗重新显示更新内容

## 下载说明
- macOS Universal DMG
`),
    ).toEqual(['普通回车只换一行', '更新弹窗重新显示更新内容'])
  })

  it('hides legacy technical release text without an update section', () => {
    expect(extractUpdateHighlights('- Signed package\n- Windows x64 installer')).toEqual([])
  })
})
