import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/**
 * 专注模式：给光标所在的顶层块加 .is-focused 装饰，配合 CSS 淡化其它块。
 * 装饰始终添加（无副作用），是否淡化由编辑器容器上的 .focus-mode 类决定。
 */
export const focusPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('xmd-focus'),
      props: {
        decorations(state) {
          const { $head } = state.selection
          if ($head.depth < 1) return null
          try {
            const before = $head.before(1)
            const after = $head.after(1)
            return DecorationSet.create(state.doc, [
              Decoration.node(before, after, { class: 'is-focused' })
            ])
          } catch {
            return null
          }
        }
      }
    })
)
