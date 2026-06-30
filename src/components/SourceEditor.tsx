import { useEffect, useRef } from 'react'

interface Props {
  content: string
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
  onChange: (markdown: string) => void
}

/** 源码模式：直接编辑原始 Markdown 文本 */
export default function SourceEditor({
  content,
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
  useEffect(() => {
    const editor = ref.current
    if (!editor) return
    if (editor.value !== content) editor.value = content
    editor.scrollTop = initialScrollTop

    return () => {
      onScrollTopChangeRef.current?.(editor.scrollTop)
      // 输入事件与标签切换落在同一帧时，卸载前再提交一次当前草稿。
      if (editor.value !== contentRef.current) onChangeRef.current(editor.value)
    }
  }, [])

  return (
    <textarea
      ref={ref}
      className="source-editor"
      defaultValue={content}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onScroll={(e) => onScrollTopChangeRef.current?.(e.currentTarget.scrollTop)}
      placeholder="# 在此输入 Markdown…"
    />
  )
}
