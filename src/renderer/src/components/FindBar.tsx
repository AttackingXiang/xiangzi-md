import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface Props {
  onClose: () => void
}

/** 页内查找条，基于 Electron 原生 findInPage */
export default function FindBar({ onClose }: Props): JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      window.api.stopFind()
    }
  }, [])

  const find = (forward: boolean, findNext: boolean): void => {
    if (text) window.api.findInPage(text, forward, findNext)
  }

  return (
    <div className="findbar">
      <input
        ref={inputRef}
        className="find-input"
        placeholder="查找…"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value) window.api.findInPage(e.target.value, true, false)
          else window.api.stopFind()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(!e.shiftKey, true)
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="icon-btn sm" title="上一个 (Shift+Enter)" onClick={() => find(false, true)}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn sm" title="下一个 (Enter)" onClick={() => find(true, true)}>
        <ChevronDown size={15} />
      </button>
      <button className="icon-btn sm" title="关闭 (Esc)" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
