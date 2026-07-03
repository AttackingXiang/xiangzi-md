import type { EditorState } from '@milkdown/kit/prose/state'
import { undoDepth, redoDepth } from 'prosemirror-history'

export interface ToolbarActiveState {
  bold: boolean
  italic: boolean
  strike: boolean
  inlineCode: boolean
  link: boolean
  headingLevel: number | null // 1-6 or null
  blockquote: boolean
  codeBlock: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  canUndo: boolean
  canRedo: boolean
}

const DEFAULT_STATE: ToolbarActiveState = {
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  headingLevel: null,
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  canUndo: false,
  canRedo: false,
}

type Listener = (state: ToolbarActiveState) => void
let _listener: Listener | null = null
let _lastState: ToolbarActiveState = DEFAULT_STATE

export function computeToolbarState(editorState: EditorState): ToolbarActiveState {
  const { selection, schema } = editorState
  const { $from } = selection

  const marks = editorState.storedMarks ?? $from.marks()
  const hasMark = (name: string): boolean => {
    const t = schema.marks[name]
    return t ? marks.some((m) => m.type === t) : false
  }

  let headingLevel: number | null = null
  let blockquote = false
  let codeBlock = false
  let bulletList = false
  let orderedList = false
  let taskList = false

  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d)
    if (!n) continue
    const nt = n.type
    if (schema.nodes.heading && nt === schema.nodes.heading) {
      headingLevel = n.attrs.level as number
    } else if (schema.nodes.blockquote && nt === schema.nodes.blockquote) {
      blockquote = true
    } else if (schema.nodes.code_block && nt === schema.nodes.code_block) {
      codeBlock = true
    } else if (schema.nodes.bullet_list && nt === schema.nodes.bullet_list) {
      bulletList = true
    } else if (schema.nodes.ordered_list && nt === schema.nodes.ordered_list) {
      orderedList = true
    }
  }

  // Task list: bullet_list containing list_item nodes that have checked attr
  if (bulletList && schema.nodes.list_item) {
    const listItem = $from.node($from.depth - 1) ?? $from.node($from.depth)
    if (listItem?.type === schema.nodes.list_item && listItem.attrs.checked != null) {
      taskList = true
      bulletList = false
    }
  }

  return {
    bold: hasMark('strong'),
    italic: hasMark('emphasis'),
    strike: hasMark('strike'),
    inlineCode: hasMark('inlineCode'),
    link: hasMark('link'),
    headingLevel,
    blockquote,
    codeBlock,
    bulletList,
    orderedList,
    taskList,
    canUndo: undoDepth(editorState) > 0,
    canRedo: redoDepth(editorState) > 0,
  }
}

export const toolbarStateBridge = {
  setListener(fn: Listener | null): void {
    _listener = fn
    if (fn) fn(_lastState)
  },
  notify(state: ToolbarActiveState): void {
    _lastState = state
    _listener?.(state)
  },
  reset(): void {
    _lastState = DEFAULT_STATE
    _listener?.(DEFAULT_STATE)
  },
}
