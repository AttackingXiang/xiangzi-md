import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import { desktop } from '../platform'
import {
  hasEditor,
  searchClear,
  searchFind,
  searchNext,
  searchPrev,
  searchReplace,
  searchReplaceAll,
} from '../lib/searchBridge'
import { t } from '../lib/i18n'

interface Props {
  initialQuery?: string
  /** Line number hint from full-text search; used to scroll to the match after open */
  initialLine?: number
  /** Zero-based query occurrence returned by the folder search command. */
  initialMatchIndex?: number
  onClose: () => void
}

/**
 * 查找/替换条：
 * - Markdown 模式走 CM6 SearchQuery（编辑器内高亮 + 替换）
 * - 源码模式退回 Electron 原生 findInPage（仅查找）
 */
export default function FindBar({
  initialQuery = '',
  initialLine,
  initialMatchIndex,
  onClose,
}: Props): JSX.Element {
  const [find, setFind] = useState(initialQuery)
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const wysiwyg = hasEditor()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    if (initialQuery) {
      const timer = setTimeout(() => {
        if (hasEditor()) {
          searchFind(initialQuery, '')
          if (initialMatchIndex !== undefined) {
            for (let index = 0; index < initialMatchIndex; index += 1) searchNext()
          }
        } else {
          void desktop.findInPage(initialQuery, true, false)
        }
      }, 450)
      return () => {
        clearTimeout(timer)
        searchClear()
        void desktop.stopFind()
      }
    }
    return () => {
      searchClear()
      void desktop.stopFind()
    }
  }, [initialQuery, initialLine, initialMatchIndex])

  const runFind = (text: string): void => {
    if (!text) {
      searchClear()
      void desktop.stopFind()
      return
    }
    if (hasEditor()) searchFind(text, replace)
    else void desktop.findInPage(text, true, false)
  }

  const goNext = (): void => {
    if (hasEditor()) searchNext()
    else if (find) void desktop.findInPage(find, true, true)
  }
  const goPrev = (): void => {
    if (hasEditor()) searchPrev()
    else if (find) void desktop.findInPage(find, false, true)
  }

  return (
    <div className="findbar">
      <button
        className={`icon-btn sm${showReplace ? ' active' : ''}`}
        title={t('替换')}
        onClick={() => setShowReplace((v) => !v)}
      >
        <Replace size={15} />
      </button>

      <div className="findbar-fields">
        <div className="findbar-row">
          <input
            ref={inputRef}
            className="find-input"
            placeholder={t('查找…')}
            value={find}
            onChange={(e) => {
              setFind(e.target.value)
              runFind(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) goPrev()
                else goNext()
              }
              if (e.key === 'Escape') onClose()
            }}
          />
          <button className="icon-btn sm" title={`${t('上一个')} (⇧Enter)`} onClick={goPrev}>
            <ChevronUp size={15} />
          </button>
          <button className="icon-btn sm" title={`${t('下一个')} (Enter)`} onClick={goNext}>
            <ChevronDown size={15} />
          </button>
        </div>

        {showReplace && (
          <div className="findbar-row">
            <input
              className="find-input"
              placeholder={wysiwyg ? t('替换为…') : t('源码模式暂不支持替换')}
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
              {t('替换')}
            </button>
            <button
              className="text-btn"
              disabled={!wysiwyg || !find}
              onClick={() => searchReplaceAll(find, replace)}
            >
              {t('全部替换')}
            </button>
          </div>
        )}
      </div>

      <button className="icon-btn sm" title={`${t('关闭')} (Esc)`} onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
