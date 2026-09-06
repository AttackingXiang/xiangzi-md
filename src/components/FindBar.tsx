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
  searchStatus,
  subscribeEditorAvailability,
  type SearchNavigationOutcome,
} from '../lib/searchBridge'
import { findNavigationBridge } from '../lib/findNavigationBridge'
import { t } from '../lib/i18n'
import { hasOpenModal } from '../lib/modalStack'

interface Props {
  documentKey?: string | null
  initialQuery?: string
  /** Line number hint from full-text search; used to scroll to the match after open */
  initialLine?: number
  /** Zero-based query occurrence returned by the folder search command. */
  initialMatchIndex?: number
  /** Incremented whenever the global find command should return focus here. */
  focusRequest?: number
  onClose: () => void
}

/**
 * 查找/替换条：
 * Markdown 所见即所得和源码视图共享同一个 CM6 文档与搜索状态。
 * 懒加载期间通过 active-view 订阅等待编辑器，不搜索应用外壳 DOM。
 */
export default function FindBar({
  documentKey,
  initialQuery = '',
  initialLine,
  initialMatchIndex,
  focusRequest = 0,
  onClose,
}: Props): JSX.Element {
  const [find, setFind] = useState(initialQuery.trim())
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [searchHint, setSearchHint] = useState<SearchNavigationOutcome>('match')
  const [editorAvailable, setEditorAvailable] = useState(hasEditor)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingFindRef = useRef<(() => void) | null>(null)
  const queryRef = useRef({ find, replace })
  queryRef.current = { find, replace }
  const previousDocumentRef = useRef(documentKey)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || hasOpenModal()) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  useEffect(() => {
    if (previousDocumentRef.current === documentKey) return
    previousDocumentRef.current = documentKey
    const refresh = (): void => {
      const query = queryRef.current
      setSearchHint(query.find ? searchFind(query.find, query.replace) : 'match')
    }
    if (hasEditor()) refresh()
    else return onEditorAvailable(refresh)
  }, [documentKey])

  const replaceEnabled = editorAvailable && canReplaceInEditor()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  useEffect(() => {
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
      setSearchHint('match')
      return
    }
    if (hasEditor()) setSearchHint(searchFind(text, replace))
    else {
      const unsubscribe = onEditorAvailable(() => {
        unsubscribe()
        pendingFindRef.current = null
        setSearchHint(searchFind(text, replace))
      })
      pendingFindRef.current = unsubscribe
    }
  }

  const goNext = (): void => {
    if (!find) return
    setSearchHint(searchNext())
  }
  const goPrev = (): void => {
    if (!find) return
    setSearchHint(searchPrev())
  }

  const hintText =
    searchHint === 'not-found'
      ? t('没有找到匹配的内容。')
      : searchHint === 'at-end'
        ? t('已到文档底部，再次查找将从头开始。')
        : searchHint === 'at-start'
          ? t('已到文档顶部，再次查找将从末尾开始。')
          : ''

  // 全局 ⌘G / F3 通过这个桥推进匹配，不需要焦点回到查找框。
  useEffect(() => {
    findNavigationBridge.setHandler((direction) => {
      if (direction === 'next') goNext()
      else goPrev()
    })
    return () => findNavigationBridge.setHandler(null)
  })

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
            />
            <button
              className="text-btn"
              disabled={!replaceEnabled || !find}
              onClick={() => {
                searchReplace(find, replace)
                setSearchHint(searchStatus())
              }}
            >
              {t('替换')}
            </button>
            <button
              className="text-btn"
              disabled={!replaceEnabled || !find}
              onClick={() => {
                searchReplaceAll(find, replace)
                setSearchHint(searchStatus())
              }}
            >
              {t('全部替换')}
            </button>
          </div>
        )}

        {hintText && (
          <div
            className={`findbar-hint${searchHint === 'not-found' ? ' is-empty' : ''}`}
            role="status"
            aria-live="polite"
          >
            {hintText}
          </div>
        )}
      </div>

      <button className="icon-btn sm" title={`${t('关闭')} (Esc)`} onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
