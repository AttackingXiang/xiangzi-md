import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node } from '@milkdown/kit/prose/model'

interface HeadingFoldState {
  folded: Set<number>
  decos: DecorationSet
}

const headingFoldKey = new PluginKey<HeadingFoldState>('xmd-heading-fold')

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

function buildFoldDecos(doc: Node, folded: Set<number>): DecorationSet {
  const decos: Decoration[] = []
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
}

export const headingFoldPlugin = $prose(
  () =>
    new Plugin({
      key: headingFoldKey,
      state: {
        init: (_, { doc }) => ({
          folded: new Set<number>(),
          decos: buildFoldDecos(doc, new Set<number>()),
        }),
        apply(tr, old, _, { doc }) {
          // Toggle meta dispatched by fold button click
          const meta = tr.getMeta(headingFoldKey) as number | undefined
          let nextFolded = old.folded
          let toggled = false

          if (meta !== undefined) {
            toggled = true
            nextFolded = new Set(old.folded)
            if (nextFolded.has(meta)) nextFolded.delete(meta)
            else nextFolded.add(meta)
          } else if (old.folded.size > 0 && tr.docChanged) {
            // Re-map folded positions through document changes
            const remapped = new Set<number>()
            for (const pos of old.folded) {
              const newPos = tr.mapping.map(pos)
              const node = tr.doc.nodeAt(newPos)
              if (node && node.type.name === 'heading') remapped.add(newPos)
            }
            nextFolded = remapped
          }

          const shouldRebuild = toggled || tr.docChanged
          return {
            folded: nextFolded,
            decos: shouldRebuild ? buildFoldDecos(doc, nextFolded) : old.decos,
          }
        },
      },
      props: {
        decorations(state) {
          return headingFoldKey.getState(state)?.decos ?? null
        },
      },
    }),
)
