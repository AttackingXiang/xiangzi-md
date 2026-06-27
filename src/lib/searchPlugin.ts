import { $prose } from '@milkdown/kit/utils'
import { search } from 'prosemirror-search'

/** 把 prosemirror-search 接入 Milkdown 编辑器，提供查找高亮与替换能力 */
export const searchPlugin = $prose(() => search())
