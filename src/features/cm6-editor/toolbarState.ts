import { redoDepth, undoDepth } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  DEFAULT_TOOLBAR_ACTIVE_STATE,
  toolbarStateBridge,
  type ToolbarActiveState,
} from '../../lib/toolbarStateBridge'

const HEADING_NODE = /^(?:ATX|Setext)Heading([1-6])$/
const CODE_BLOCK_NODES = new Set(['FencedCode', 'CodeBlock', 'IndentedCode'])
const LINK_NODES = new Set(['Link', 'Autolink', 'URL'])

function nodeNamesNearSelection(state: EditorState): Set<string> {
  const names = new Set<string>()
  const head = state.selection.main.head
  const positions = head > 0 ? [head, head - 1] : [head]
  const tree = syntaxTree(state)
  for (const position of positions) {
    let node = tree.resolveInner(position, -1)
    for (;;) {
      names.add(node.name)
      const parent = node.parent
      if (!parent) break
      node = parent
    }
  }
  return names
}

function isBetweenDelimiter(state: EditorState, delimiter: string): boolean {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const offset = head - line.from
  const opening = line.text.lastIndexOf(delimiter, offset)
  return opening >= 0 && line.text.indexOf(delimiter, opening + delimiter.length) >= offset
}

function headingFromNodes(names: ReadonlySet<string>): number | null {
  for (const name of names) {
    const match = HEADING_NODE.exec(name)
    if (match) return Number(match[1])
  }
  return null
}

function hasAny(names: ReadonlySet<string>, candidates: ReadonlySet<string>): boolean {
  for (const candidate of candidates) if (names.has(candidate)) return true
  return false
}

export function computeCm6ToolbarState(state: EditorState): ToolbarActiveState {
  const names = nodeNamesNearSelection(state)
  const line = state.doc.lineAt(state.selection.main.head).text
  const headingPrefix = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(line)
  const taskList = /^\s*(?:[-+*])\s+\[[ xX]\](?:\s|$)/.test(line)
  const orderedList = /^\s*\d+[.)](?:\s|$)/.test(line)
  const bulletList = !taskList && /^\s*[-+*](?:\s|$)/.test(line)

  return {
    ...DEFAULT_TOOLBAR_ACTIVE_STATE,
    bold: names.has('StrongEmphasis'),
    italic: names.has('Emphasis'),
    strike: names.has('Strikethrough') || isBetweenDelimiter(state, '~~'),
    inlineCode: names.has('InlineCode'),
    link: hasAny(names, LINK_NODES),
    headingLevel: headingFromNodes(names) ?? (headingPrefix ? headingPrefix[1].length : null),
    blockquote: names.has('Blockquote') || /^\s{0,3}>/.test(line),
    codeBlock: hasAny(names, CODE_BLOCK_NODES),
    bulletList: names.has('BulletList') || bulletList,
    orderedList: names.has('OrderedList') || orderedList,
    taskList: names.has('TaskMarker') || taskList,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  }
}

export function equalToolbarState(a: ToolbarActiveState, b: ToolbarActiveState): boolean {
  return (Object.keys(a) as (keyof ToolbarActiveState)[]).every((key) => a[key] === b[key])
}

export const cm6ToolbarState = ViewPlugin.fromClass(
  class {
    private state: ToolbarActiveState

    constructor(update: ViewUpdate['view']) {
      this.state = computeCm6ToolbarState(update.state)
      toolbarStateBridge.notify(this.state)
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet && !update.transactions.length) return
      const next = computeCm6ToolbarState(update.state)
      if (!equalToolbarState(this.state, next)) {
        this.state = next
        toolbarStateBridge.notify(next)
      }
    }

    destroy(): void {
      toolbarStateBridge.reset()
    }
  },
)
