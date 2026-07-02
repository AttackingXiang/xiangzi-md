import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node } from '@milkdown/kit/prose/model'

const headingFoldKey = new PluginKey<Set<number>>('xmd-heading-fold')

/** Returns the document position just past the section owned by this heading. */
function getSectionEnd(doc: Node, headingPos: number, level: number): number {
  let pos = 0
  let pastSource = false
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (pos === headingPos) {
      pastSource = true
    } else if (
      pastSource &&
      child.type.name === 'heading' &&
      (child.attrs.level as number) <= level
    ) {
      return pos
    }
    pos += child.nodeSize
  }
  return doc.content.size
}

export const headingFoldPlugin = $prose(
  () =>
    new Plugin({
      key: headingFoldKey,
      state: {
        init: () => new Set<number>(),
        apply(tr, folded) {
          // Toggle meta dispatched by fold button click
          const meta = tr.getMeta(headingFoldKey) as number | undefined
          if (meta !== undefined) {
            const next = new Set(folded)
            if (next.has(meta)) next.delete(meta)
            else next.add(meta)
            return next
          }
          if (folded.size === 0 || !tr.docChanged) return folded
          // Re-map folded positions through document changes
          const next = new Set<number>()
          for (const pos of folded) {
            const newPos = tr.mapping.map(pos)
            const node = tr.doc.nodeAt(newPos)
            if (node && node.type.name === 'heading') next.add(newPos)
          }
          return next
        },
      },
      props: {
        decorations(state) {
          const folded = headingFoldKey.getState(state)
          if (!folded) return null

          const decos: Decoration[] = []
          const doc = state.doc
          let pos = 0

          for (let i = 0; i < doc.childCount; i++) {
            const node = doc.child(i)
            if (node.type.name === 'heading') {
              const headingPos = pos
              const level = node.attrs.level as number
              const isFolded = folded.has(headingPos)

              // Inject fold toggle button inside the heading node
              decos.push(
                Decoration.widget(
                  headingPos + 1,
                  (view) => {
                    const el = document.createElement('span')
                    el.className = `fold-btn${isFolded ? ' is-folded' : ''}`
                    el.setAttribute('contenteditable', 'false')
                    el.addEventListener('mousedown', (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      view.dispatch(view.state.tr.setMeta(headingFoldKey, headingPos))
                    })
                    return el
                  },
                  { side: -1, key: `fold-${headingPos}-${String(isFolded)}` },
                ),
              )

              // When folded: hide every top-level node in this section
              if (isFolded) {
                const sectionEnd = getSectionEnd(doc, headingPos, level)
                const contentStart = headingPos + node.nodeSize
                if (contentStart < sectionEnd) {
                  let childPos = 0
                  for (let j = 0; j < doc.childCount; j++) {
                    const child = doc.child(j)
                    if (childPos >= contentStart && childPos < sectionEnd) {
                      decos.push(
                        Decoration.node(childPos, childPos + child.nodeSize, {
                          class: 'heading-fold-hidden',
                        }),
                      )
                    }
                    childPos += child.nodeSize
                    if (childPos >= sectionEnd) break
                  }
                }
              }
            }
            pos += node.nodeSize
          }

          return DecorationSet.create(doc, decos)
        },
      },
    }),
)
