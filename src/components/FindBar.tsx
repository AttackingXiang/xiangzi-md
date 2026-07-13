import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import {
  canReplaceInEditor,
  hasEditor,
  onEditorAvailable,
  searchClear,
  searchFind,
  searchNext,
  searchPrev,
  searchReplace,
  searchReplaceAll,
  searchMountedEditor,
  subscribeEditorAvailability,
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
 * Markdown 所见即所得和源码视图共享同一个 CM6 文档与搜索状态。
 * 懒加载期间通过 active-view 订阅等待编辑器，不搜索应用外壳 DOM。
 */
export default function FindBar({
  initialQuery = '',
  initialLine,
  initialMatchIndex,
  onClose,
}: Props): JSX.Element {
  const [find, setFind] = useState(initialQuery.trim())
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [editorAvailable, setEditorAvailable] = useState(hasEditor)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingFindRef = useRef<(() => void) | null>(null)

  const replaceEnabled = editorAvailable && canReplaceInEditor()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    return subscribeEditorAvailability(setEditorAvailable)
  }, [])

  useEffect(() => {
    const query = initialQuery.trim()
    setFind(query)
    let unsubscribe: (() => void) | undefined
    if (query) {
      if (hasEditor()) searchMountedEditor(query, initialMatchIndex ?? 0, initialLine)
      else {
        unsubscribe = onEditorAvailable(() => {
          unsubscribe?.()
          searchMountedEditor(query, initialMatchIndex ?? 0, initialLine)
        })
      }
    }
    return () => {
      unsubscribe?.()
      searchClear()
    }
  }, [initialQuery, initialLine, initialMatchIndex])

  useEffect(
    () => () => {
      pendingFindRef.current?.()
    },
    [],
  )

  const runFind = (text: string): void => {
    pendingFindRef.current?.()
    pendingFindRef.current = null
    if (!text) {
      searchClear()
      return
    }
    if (hasEditor()) searchFind(text, replace)
    else {
      const unsubscribe = onEditorAvailable(() => {
        unsubscribe()
        pendingFindRef.current = null
        searchFind(text, replace)
      })
      pendingFindRef.current = unsubscribe
    }
  }

  const goNext = (): void => {
    if (!find) return
    searchNext()
  }
  const goPrev = (): void => {
    if (!find) return
    searchPrev()
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
              placeholder={t('替换为…')}
              value={replace}
              disabled={!replaceEnabled}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
            <button
              className="text-btn"
              disabled={!replaceEnabled || !find}
              onClick={() => searchReplace(find, replace)}
            >
              {t('替换')}
            </button>
            <button
              className="text-btn"
              disabled={!replaceEnabled || !find}
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
