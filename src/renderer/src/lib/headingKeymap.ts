import { $prose } from '@milkdown/kit/utils'
import { schemaCtx } from '@milkdown/kit/core'
import { keymap } from '@milkdown/kit/prose/keymap'
import { setBlockType } from '@milkdown/kit/prose/commands'

/**
 * Typora 风格的标题快捷键：⌘1~⌘6 设为对应级别标题，⌘0 设为正文。
 * 与 Milkdown 内置的 ⌘⌥1~6 并存。
 */
export const typoraHeadingKeymap = $prose((ctx) => {
  const schema = ctx.get(schemaCtx)
  const heading = schema.nodes.heading
  const paragraph = schema.nodes.paragraph
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindings: Record<string, any> = {}
  if (heading) {
    for (let level = 1; level <= 6; level++) {
      bindings[`Mod-${level}`] = setBlockType(heading, { level })
    }
  }
  if (paragraph) {
    bindings['Mod-0'] = setBlockType(paragraph)
  }
  return keymap(bindings)
})
