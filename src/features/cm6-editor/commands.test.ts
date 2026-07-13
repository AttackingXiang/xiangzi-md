import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  insertCodeFence,
  insertLink,
  insertTable,
  setHeading,
  setParagraph,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleOrderedList,
  toggleStrike,
  toggleTaskList,
} from './commands'

function run(
  doc: string,
  selection: SelectionRange,
  command: Parameters<typeof execute>[2],
): { doc: string; from: number; to: number } {
  return execute(doc, selection, command)
}

function execute(
  doc: string,
  selection: SelectionRange,
  command: Command,
): { doc: string; from: number; to: number } {
  let state = EditorState.create({ doc, selection: EditorSelection.create([selection]) })
  const target = {
    state,
    dispatch: (transaction: ReturnType<EditorState['update']>) => (state = transaction.state),
  } as unknown as EditorView
  expect(command(target)).toBe(true)
  return { doc: state.doc.toString(), from: state.selection.main.from, to: state.selection.main.to }
}

describe('CM6 Markdown commands', () => {
  it('inserts an inline pair at an empty cursor and places the cursor inside', () => {
    expect(run('中文', EditorSelection.cursor(2), toggleBold)).toEqual({
      doc: '中文****',
      from: 4,
      to: 4,
    })
  })

  it('wraps and unwraps a Chinese selection without losing the selection', () => {
    const wrapped = run('你好世界', EditorSelection.range(0, 2), toggleStrike)
    expect(wrapped).toEqual({ doc: '~~你好~~世界', from: 2, to: 4 })
    expect(run(wrapped.doc, EditorSelection.range(wrapped.from, wrapped.to), toggleStrike)).toEqual(
      {
        doc: '你好世界',
        from: 0,
        to: 2,
      },
    )
  })

  it('supports inline code around a multiline selection', () => {
    expect(run('甲\n乙', EditorSelection.range(0, 3), toggleInlineCode)).toEqual({
      doc: '`甲\n乙`',
      from: 1,
      to: 4,
    })
  })

  it('sets and removes headings on every selected line', () => {
    const heading = run('甲\n## 乙', EditorSelection.range(0, 6), setHeading(3))
    expect(heading.doc).toBe('### 甲\n### 乙')
    expect(run(heading.doc, EditorSelection.range(0, heading.doc.length), setParagraph).doc).toBe(
      '甲\n乙',
    )
  })

  it('toggles blockquotes across multiple lines', () => {
    const quoted = run('甲\n乙', EditorSelection.range(0, 3), toggleBlockquote)
    expect(quoted.doc).toBe('> 甲\n> 乙')
    expect(run(quoted.doc, EditorSelection.range(0, quoted.doc.length), toggleBlockquote).doc).toBe(
      '甲\n乙',
    )
  })

  it('converts selected list lines between bullet, ordered, and task forms', () => {
    const bullet = run('甲\n乙', EditorSelection.range(0, 3), toggleBulletList)
    expect(bullet.doc).toBe('- 甲\n- 乙')
    const ordered = run(bullet.doc, EditorSelection.range(0, bullet.doc.length), toggleOrderedList)
    expect(ordered.doc).toBe('1. 甲\n2. 乙')
    const task = run(ordered.doc, EditorSelection.range(0, ordered.doc.length), toggleTaskList)
    expect(task.doc).toBe('- [ ] 甲\n- [ ] 乙')
  })

  it('inserts a fenced block and selects the original content', () => {
    expect(run('你好', EditorSelection.range(0, 2), insertCodeFence('ts'))).toEqual({
      doc: '```ts\n你好\n```',
      from: 6,
      to: 8,
    })
  })

  it('inserts an empty fenced block with the cursor on its body line', () => {
    expect(run('', EditorSelection.cursor(0), insertCodeFence())).toEqual({
      doc: '```\n\n```',
      from: 4,
      to: 4,
    })
  })

  it('inserts links for both selected and empty text', () => {
    expect(run('官网', EditorSelection.range(0, 2), insertLink('https://example.com'))).toEqual({
      doc: '[官网](https://example.com)',
      from: 1,
      to: 3,
    })
    expect(run('', EditorSelection.cursor(0), insertLink()).doc).toBe('[链接文字](https://)')
  })

  it('inserts a rectangular Markdown table and selects the first header', () => {
    const result = run('', EditorSelection.cursor(0), insertTable(3, 2))
    expect(result.doc).toBe('| 列 1 | 列 2 |\n| --- | --- |\n|     |     |\n|     |     |')
    expect(result).toMatchObject({ from: 2, to: 5 })
  })
})
