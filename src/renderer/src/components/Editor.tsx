import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

interface Props {
  content: string
  onChange: (markdown: string) => void
}

/**
 * 所见即所得编辑器（Typora 风格），基于 Milkdown Crepe（ProseMirror 内核）。
 * 组件以 tab.id 作为 key，切换标签时重建实例。
 */
export default function Editor({ content, onChange }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const crepe = new Crepe({
      root,
      defaultValue: content
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    let destroyed = false
    crepe.create().then(() => {
      if (destroyed) crepe.destroy()
    })

    return () => {
      destroyed = true
      crepe.destroy()
    }
    // 仅在挂载时创建；内容更新由 Crepe 内部维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wysiwyg-editor" ref={rootRef} />
}
