import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import {
  hasEditor,
  searchClear,
  searchFind,
  searchNext,
  searchPrev,
  searchReplace,
  searchReplaceAll
} from '../lib/searchBridge'

interface Props {
  initialQuery?: string
  onClose: () => void
}

/**
 * 查找/替换条：
 * - 所见即所得模式走 prosemirror-search（编辑器内高亮 + 替换）
 * - 源码模式退回 Electron 原生 findInPage（仅查找）
 */
export default function FindBar({ initialQuery = '', onClose }: Props): JSX.Element {
  const [find, setFind] = useState(initialQuery)
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const wysiwyg = hasEditor()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    // 来自全文搜索时，待编辑器就绪后高亮初始关键词
    if (initialQuery) {
      const t = setTimeout(() => {
        if (hasEditor()) searchFind(initialQuery, '')
        else window.api.findInPage(initialQuery, true, false)
      }, 450)
      return () => {
        clearTimeout(t)
        searchClear()
        window.api.stopFind()
      }
    }
    return () => {
      searchClear()
      window.api.stopFind()
    }
  }, [initialQuery])

  const runFind = (text: string): void => {
    if (!text) {
      searchClear()
      window.api.stopFind()
      return
    }
    if (hasEditor()) searchFind(text, replace)
    else window.api.findInPage(text, true, false)
  }

  const goNext = (): void => {
    if (hasEditor()) searchNext()
    else if (find) window.api.findInPage(find, true, true)
  }
  const goPrev = (): void => {
    if (hasEditor()) searchPrev()
    else if (find) window.api.findInPage(find, false, true)
  }

  return (
    <div className="findbar">
      <button
        className={`icon-btn sm${showReplace ? ' active' : ''}`}
        title="替换"
        onClick={() => setShowReplace((v) => !v)}
      >
        <Replace size={15} />
      </button>

      <div className="findbar-fields">
        <div className="findbar-row">
          <input
            ref={inputRef}
            className="find-input"
            placeholder="查找…"
            value={find}
            onChange={(e) => {
              setFind(e.target.value)
              runFind(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.shiftKey ? goPrev() : goNext()
              }
              if (e.key === 'Escape') onClose()
            }}
          />
          <button className="icon-btn sm" title="上一个 (⇧Enter)" onClick={goPrev}>
            <ChevronUp size={15} />
          </button>
          <button className="icon-btn sm" title="下一个 (Enter)" onClick={goNext}>
            <ChevronDown size={15} />
          </button>
        </div>

        {showReplace && (
          <div className="findbar-row">
            <input
              className="find-input"
              placeholder={wysiwyg ? '替换为…' : '源码模式暂不支持替换'}
              value={replace}
              disabled={!wysiwyg}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
            <button
              className="text-btn"
              disabled={!wysiwyg || !find}
              onClick={() => searchReplace(find, replace)}
            >
              替换
            </button>
            <button
              className="text-btn"
              disabled={!wysiwyg || !find}
              onClick={() => searchReplaceAll(find, replace)}
            >
              全部替换
            </button>
          </div>
        )}
      </div>

      <button className="icon-btn sm" title="关闭 (Esc)" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
