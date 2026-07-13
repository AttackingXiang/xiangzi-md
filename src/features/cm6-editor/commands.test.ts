import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  type Transaction,
} from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Command, EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { history } from '@codemirror/commands'
import { describe, expect, it, vi } from 'vitest'
import {
  createCm6Commands,
  insertCodeFence,
  insertLink,
  insertTable,
  planRemoveLink,
  removeLink,
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

const markdownExtension = markdown({ base: markdownLanguage, extensions: GFM })

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
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create([selection]),
    extensions: [markdownExtension],
  })
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

  it('removes the active inline mark at a caret instead of nesting empty markers', () => {
    expect(run('**加粗文字**', EditorSelection.cursor(4), toggleBold)).toEqual({
      doc: '加粗文字',
      from: 2,
      to: 2,
    })
  })

  it('removes an inline mark only from the selected part of an existing span', () => {
    expect(run('**abcdef**', EditorSelection.range(4, 6), toggleBold)).toEqual({
      doc: '**ab**cd**ef**',
      from: 6,
      to: 8,
    })
  })

  it('merges a selected plain range with adjacent or contained identical marks', () => {
    expect(run('**bold** plain', EditorSelection.range(2, 14), toggleBold)).toEqual({
      doc: '**bold plain**',
      from: 2,
      to: 12,
    })
    expect(run('x **bold** y', EditorSelection.range(0, 12), toggleBold)).toEqual({
      doc: '**x bold y**',
      from: 2,
      to: 10,
    })
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

  it('preserves quote and list containers when changing the nested block style', () => {
    expect(run('> - text', EditorSelection.cursor(6), setHeading(3)).doc).toBe('> - ### text')
    expect(run('> - item', EditorSelection.cursor(6), toggleOrderedList).doc).toBe('> 1. item')
    expect(run('> - item', EditorSelection.cursor(6), toggleBulletList).doc).toBe('> item')
  })

  it('converts headings, quotes and lists to an ordinary paragraph', () => {
    expect(run('> - ### text', EditorSelection.cursor(9), setParagraph).doc).toBe('text')
    expect(run('  ## heading', EditorSelection.cursor(8), setParagraph).doc).toBe('  heading')
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

  it('turns the current non-empty line into a valid fenced block', () => {
    expect(
      run('before\nconst x = 1\nafter', EditorSelection.cursor(14), insertCodeFence('js')),
    ).toEqual({
      doc: 'before\n```js\nconst x = 1\n```\nafter',
      from: 13,
      to: 24,
    })
  })

  it('chooses a longer fence when selected code contains backticks', () => {
    expect(run('const value = ```', EditorSelection.range(0, 17), insertCodeFence()).doc).toBe(
      '````\nconst value = ```\n````',
    )
  })

  it('removes code fences when converting a code block to a paragraph', () => {
    const state = EditorState.create({
      doc: '```ts\nconst x = 1\n```',
      selection: EditorSelection.cursor(10),
      extensions: [markdownExtension],
    })
    expect(run(state.doc.toString(), state.selection.main, setParagraph)).toEqual({
      doc: 'const x = 1\n',
      from: 4,
      to: 4,
    })
  })

  it('toggles an active fenced or indented code block back to paragraph text', () => {
    expect(
      run('```js\nconst x = 1\n```', EditorSelection.cursor(12), insertCodeFence('js')).doc,
    ).toBe('const x = 1\n')
    expect(run('    first\n    second', EditorSelection.cursor(6), setParagraph).doc).toBe(
      'first\nsecond',
    )
  })

  it('inserts links for both selected and empty text', () => {
    expect(run('官网', EditorSelection.range(0, 2), insertLink('https://example.com'))).toEqual({
      doc: '[官网](https://example.com)',
      from: 1,
      to: 3,
    })
    expect(run('', EditorSelection.cursor(0), insertLink()).doc).toBe('[链接文字](https://)')
  })

  it('removes Markdown and autolink destinations while retaining visible text', () => {
    expect(run('[官网](https://example.com)', EditorSelection.cursor(2), removeLink)).toEqual({
      doc: '官网',
      from: 1,
      to: 1,
    })
    expect(run('<https://example.com>', EditorSelection.cursor(5), removeLink).doc).toBe(
      'https://example.com',
    )
    expect(
      run('[![alt](image.png)](https://example.com)', EditorSelection.cursor(5), removeLink).doc,
    ).toBe('![alt](image.png)')
    expect(
      planRemoveLink(EditorState.create({ doc: 'plain', extensions: [markdownExtension] })),
    ).toBeNull()
  })

  it('inserts a rectangular Markdown table and selects the first header', () => {
    const result = run('', EditorSelection.cursor(0), insertTable(3, 2))
    expect(result.doc).toBe('| 列 1 | 列 2 |\n| --- | --- |\n|     |     |\n|     |     |')
    expect(result).toMatchObject({ from: 2, to: 5 })
  })

  it('adds block boundaries when inserting a table inside paragraph text', () => {
    expect(run('before after', EditorSelection.cursor(6), insertTable(2, 1)).doc).toBe(
      'before\n\n| 列 1 |\n| --- |\n|     |\n\n after',
    )
  })

  it('does not run formatting commands against a read-only editor state', () => {
    const state = EditorState.create({
      doc: 'read only',
      extensions: [markdownExtension, EditorState.readOnly.of(true)],
    })
    const target = { state, dispatch: () => undefined } as unknown as EditorView
    expect(toggleBold(target)).toBe(false)
  })

  it('uses the CM6 history for toolbar undo and redo and restores focus', () => {
    let state = EditorState.create({ doc: 'a', extensions: [markdownExtension, history()] })
    state = state.update({ changes: { from: 1, insert: 'b' } }).state
    const focus = vi.fn()
    const view = {
      get state() {
        return state
      },
      dispatch(transaction: Transaction) {
        state = transaction.state
      },
      focus,
    } as unknown as EditorView
    const commands = createCm6Commands(() => view)

    expect(commands.undo()).toBe(true)
    expect(state.doc.toString()).toBe('a')
    expect(commands.redo()).toBe(true)
    expect(state.doc.toString()).toBe('ab')
    expect(focus).toHaveBeenCalledTimes(2)
  })
})
