import type { Node as ProseNode, NodeType } from '@milkdown/kit/prose/model'
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state'
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list'

export type ListStyle = 'bullet' | 'ordered' | 'task'

interface ListTypes {
  bullet: NodeType
  ordered: NodeType
  item: NodeType
}

interface ListContext {
  depth: number
  node: ProseNode
  pos: number
  item: ProseNode | null
}

function findListContext(
  state: Pick<EditorState, 'selection'>,
  types: ListTypes,
): ListContext | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type !== types.bullet && node.type !== types.ordered) continue
    let item: ProseNode | null = null
    for (let itemDepth = $from.depth; itemDepth > depth; itemDepth -= 1) {
      if ($from.node(itemDepth).type === types.item) {
        item = $from.node(itemDepth)
        break
      }
    }
    return { depth, node, pos: $from.before(depth), item }
  }
  return null
}

function styleOf(context: ListContext, types: ListTypes): ListStyle {
  if (context.item?.attrs.checked != null) return 'task'
  return context.node.type === types.ordered ? 'ordered' : 'bullet'
}

export function listStyleFromState(state: EditorState): ListStyle | null {
  const { bullet_list: bullet, ordered_list: ordered, list_item: item } = state.schema.nodes
  if (!bullet || !ordered || !item) return null
  const context = findListContext(state, { bullet, ordered, item })
  return context ? styleOf(context, { bullet, ordered, item }) : null
}

function setListItemStyle(
  tr: Transaction,
  context: ListContext,
  itemType: NodeType,
  style: ListStyle,
): Transaction {
  const order = typeof context.node.attrs.order === 'number' ? context.node.attrs.order : 1
  context.node.forEach((node, relativePos, index) => {
    if (node.type !== itemType) return
    tr.setNodeMarkup(context.pos + 1 + relativePos, itemType, {
      ...node.attrs,
      label: style === 'ordered' ? `${index + order}.` : '•',
      listType: style === 'ordered' ? 'ordered' : 'bullet',
      checked: style === 'task' ? node.attrs.checked === true : null,
    })
  })
  return tr
}

/** One canonical transaction for wrapping, switching, or lifting all list styles. */
export function toggleListStyleCommand(style: ListStyle): Command {
  return (state, dispatch) => {
    const { bullet_list: bullet, ordered_list: ordered, list_item: item } = state.schema.nodes
    if (!bullet || !ordered || !item) return false
    const types = { bullet, ordered, item }
    const current = findListContext(state, types)

    if (current && styleOf(current, types) === style) {
      return liftListItem(item)(state, dispatch)
    }

    const target = style === 'ordered' ? ordered : bullet
    if (!current) {
      let wrapped: Transaction | null = null
      if (!wrapInList(target)(state, (transaction) => (wrapped = transaction)) || !wrapped) {
        return false
      }
      const tr = wrapped as Transaction
      const created = findListContext({ selection: tr.selection }, types)
      if (created) setListItemStyle(tr, created, item, style)
      dispatch?.(tr.scrollIntoView())
      return true
    }

    const bookmark = state.selection.getBookmark()
    let tr = state.tr.setNodeMarkup(current.pos, target, {
      ...(style === 'ordered' ? { order: 1 } : {}),
      spread: current.node.attrs.spread === true,
    })
    tr = setListItemStyle(tr, current, item, style)
    tr.setSelection(bookmark.resolve(tr.doc))
    dispatch?.(tr.scrollIntoView())
    return true
  }
}
