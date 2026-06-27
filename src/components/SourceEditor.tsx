import { useEffect, useRef } from 'react'

interface Props {
  content: string
  onChange: (markdown: string) => void
}

/** 源码模式：直接编辑原始 Markdown 文本 */
export default function SourceEditor({ content, onChange }: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  // 初始化内容（受控成本高，这里用非受控 + 初值，避免大文档卡顿）
  useEffect(() => {
    if (ref.current && ref.current.value !== content) {
      ref.current.value = content
    }
  }, [])

  return (
    <textarea
      ref={ref}
      className="source-editor"
      defaultValue={content}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      placeholder="# 在此输入 Markdown…"
    />
  )
}
