import type { Schema } from '@milkdown/kit/prose/model'
import type { Command } from '@milkdown/kit/prose/state'
import { toggleMark, setBlockType, wrapIn } from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { editorBridge } from './editorBridge'

/** 用当前活跃编辑器执行一个由 schema 构造的命令 */
function exec(make: (schema: Schema) => Command | false | null | undefined): void {
  const view = editorBridge.get()
  if (!view) return
  const cmd = make(view.state.schema)
  if (!cmd) return
  cmd(view.state, view.dispatch)
  view.focus()
}

/** 是否有可用的所见即所得编辑器（源码模式下没有） */
export function hasWysiwyg(): boolean {
  return !!editorBridge.get()
}

export const editorCmd = {
  bold: () => exec((s) => s.marks.strong && toggleMark(s.marks.strong)),
  italic: () => exec((s) => s.marks.emphasis && toggleMark(s.marks.emphasis)),
  inlineCode: () => exec((s) => s.marks.inlineCode && toggleMark(s.marks.inlineCode)),
  heading: (level: number) =>
    exec((s) => s.nodes.heading && setBlockType(s.nodes.heading, { level })),
  paragraph: () => exec((s) => s.nodes.paragraph && setBlockType(s.nodes.paragraph)),
  codeBlock: () => exec((s) => s.nodes.code_block && setBlockType(s.nodes.code_block)),
  bulletList: () => exec((s) => s.nodes.bullet_list && wrapInList(s.nodes.bullet_list)),
  orderedList: () => exec((s) => s.nodes.ordered_list && wrapInList(s.nodes.ordered_list)),
  quote: () => exec((s) => s.nodes.blockquote && wrapIn(s.nodes.blockquote)),
}

/** 剪贴板操作（依赖编辑器内当前选区，菜单项以 mousedown preventDefault 保留选区） */
export const clipboardCmd = {
  copy: () => document.execCommand('copy'),
  cut: () => document.execCommand('cut'),
  paste: () => document.execCommand('paste'),
  selectAll: () => {
    const view = editorBridge.get()
    if (view) {
      view.focus()
      document.execCommand('selectAll')
    } else {
      document.execCommand('selectAll')
    }
  },
}
