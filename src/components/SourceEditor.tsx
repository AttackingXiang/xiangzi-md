import { useLayoutEffect, useRef } from 'react'
import { t } from '../lib/i18n'

interface Props {
  content: string
  /** 阅读模式：源码只读，尝试编辑时提示先关闭 */
  readingMode?: boolean
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
  onChange: (markdown: string) => void
}

/** 源码模式：直接编辑原始 Markdown 文本 */
export default function SourceEditor({
  content,
  readingMode = false,
  initialScrollTop = 0,
  onScrollTopChange,
  onChange,
}: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  onScrollTopChangeRef.current = onScrollTopChange

  // 初始化内容（受控成本高，这里用非受控 + 初值，避免大文档卡顿）
  useLayoutEffect(() => {
    const editor = ref.current
    if (!editor) return
    if (editor.value !== content) editor.value = content
    editor.scrollTop = initialScrollTop

    return () => {
      // 输入事件与标签切换落在同一帧时，卸载前再提交一次当前草稿。
      if (editor.value !== contentRef.current) onChangeRef.current(editor.value)
    }
  }, [])

  const showReadingHint = (): void => {
    const editor = ref.current
    if (!editor?.parentElement || editor.parentElement.querySelector('.reading-mode-toast')) return
    const el = document.createElement('div')
    el.className = 'reading-mode-toast'
    el.textContent = t('请先关闭阅读模式')
    editor.parentElement.appendChild(el)
    window.setTimeout(() => el.remove(), 1600)
  }

  return (
    <textarea
      ref={ref}
      className="source-editor"
      defaultValue={content}
      spellCheck={false}
      readOnly={readingMode}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (!readingMode || e.metaKey || e.ctrlKey || e.altKey) return
        const mutates =
          e.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key)
        if (mutates) showReadingHint()
      }}
      onScroll={(e) => onScrollTopChangeRef.current?.(e.currentTarget.scrollTop)}
      placeholder="# 在此输入 Markdown…"
    />
  )
}
