import { useEffect, useRef } from 'react'
import { Crosshair, FileText, Search, X } from 'lucide-react'
import type { SearchResult } from '../types'
import type { FolderSearchMode } from '../platform/contracts'
import type { FolderSearchState } from '../hooks/useFolderSearch'
import { t, getLang } from '../lib/i18n'

interface Props {
  /** 搜索状态住在 App 层（见 useFolderSearch 的注释），这里只负责渲染。 */
  search: FolderSearchState
  /** Incremented when the folder-search shortcut should return focus here. */
  focusRequest?: number
  onOpenResult: (path: string, query: string, lineNumber?: number, matchIndex?: number) => void
  onOpenFile: (path: string) => void
  /** 在文件树里定位这个结果（切回文件模式并展开到它）。 */
  onRevealInTree: (path: string) => void
  /** 空查询时按 Esc：离开搜索、回到文件树。 */
  onExit: () => void
}

/** 把匹配文本里的 query 高亮 */
function highlight(text: string, query: string): JSX.Element {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: JSX.Element[] = []
  let i = 0
  let key = 0
  while (q && i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx < 0) {
      parts.push(<span key={key++}>{text.slice(i)}</span>)
      break
    }
    if (idx > i) parts.push(<span key={key++}>{text.slice(i, idx)}</span>)
    parts.push(
      <mark key={key++} className="search-hl">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  if (!q) parts.push(<span key={key++}>{text}</span>)
  return <>{parts}</>
}

export default function SearchPanel({
  search,
  focusRequest = 0,
  onOpenResult,
  onOpenFile,
  onRevealInTree,
  onExit,
}: Props): JSX.Element {
  const { query, mode, results, meta, loading, error, recentQueries, setQuery, setMode } = search
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusRequest])

  const en = getLang() === 'en'
  const summary = en
    ? `${results.length} files, ${meta.totalMatches} matches`
    : `${results.length} 个文件，${meta.totalMatches} 处匹配`

  // 后端截断时把「为什么」也说清楚。三种上限对用户的含义完全不同：
  // 缩小目录、加精确关键词、还是打开文件自己找——一句"已截断"帮不上忙。
  const truncationHint = !meta.truncated
    ? null
    : meta.reason === 'file_limit'
      ? en
        ? `Stopped after scanning ${meta.scannedFiles} files. Narrow the folder to see the rest.`
        : `扫描 ${meta.scannedFiles} 个文件后停止，缩小目录范围可以看到其余结果。`
      : meta.reason === 'per_file_limit'
        ? en
          ? 'Some files have more matches than shown. Open the file to see them all.'
          : '部分文件的匹配数超出显示上限，打开文件可查看全部。'
        : en
          ? 'Too many matches. Use a more specific query to see the rest.'
          : '匹配过多已截断，使用更精确的关键词可以看到其余结果。'

  /** ↑↓ 在所有结果行之间移动；Home/End 跳到首尾。 */
  const onResultsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-search-row]'))
    if (rows.length === 0) return
    event.preventDefault()
    if (event.key === 'Home') rows[0]?.focus()
    else if (event.key === 'End') rows[rows.length - 1]?.focus()
    else {
      const index = rows.indexOf(event.target as HTMLElement)
      rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  }

  /** Esc 分两级：先清空关键词（结果还在的时候多半只是想重搜），再退出搜索。 */
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (query) setQuery('')
    else onExit()
  }

  return (
    <div className="sidebar-panel search-panel">
      <div className="search-input-wrap">
        <Search size={14} />
        <input
          ref={inputRef}
          className="search-field"
          placeholder={t('在文件夹中搜索…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            title={t('清除')}
            aria-label={t('清除')}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="search-scope-wrap">
        <label htmlFor="folder-search-scope">{t('搜索范围')}</label>
        <select
          id="folder-search-scope"
          className="search-scope"
          value={mode}
          onChange={(e) => setMode(e.target.value as FolderSearchMode)}
        >
          <option value="all">{t('文件名和内容')}</option>
          <option value="content">{t('仅搜索内容')}</option>
          <option value="filename">{t('仅搜索文件名')}</option>
        </select>
      </div>

      <div className="search-meta">
        {error ?? (loading ? t('搜索中…') : query.trim() ? summary : '')}
        {!error && !loading && truncationHint && (
          <span className="search-truncated" title={truncationHint}>
            {truncationHint}
          </span>
        )}
      </div>

      <div className="sidebar-body" onKeyDown={onResultsKeyDown}>
        {!loading && !error && !query.trim() && (
          <>
            {recentQueries.length > 0 && (
              <div className="search-recent">
                <div className="search-recent-label">{t('最近搜索')}</div>
                {recentQueries.map((recent) => (
                  <button
                    key={recent}
                    type="button"
                    className="search-recent-item"
                    onClick={() => setQuery(recent)}
                  >
                    <Search size={12} />
                    <span>{recent}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="sidebar-empty search-empty">{t('输入关键词开始搜索当前文件夹。')}</p>
          </>
        )}
        {!loading && !error && query.trim() && results.length === 0 && (
          <p className="sidebar-empty search-empty">{t('没有找到匹配的内容。')}</p>
        )}
        {results.map((r: SearchResult) => (
          <div key={r.path} className="search-file">
            <div className="search-file-row">
              <button
                type="button"
                className="search-file-head"
                data-search-row
                title={r.path}
                onClick={() => onOpenFile(r.path)}
              >
                <FileText size={14} />
                <span className="search-file-name">{highlight(r.name, query)}</span>
                <span className="search-count">{r.matches.length + r.nameMatches}</span>
              </button>
              <button
                type="button"
                className="search-reveal-btn"
                title={t('在文件树中定位')}
                aria-label={t('在文件树中定位')}
                onClick={() => onRevealInTree(r.path)}
              >
                <Crosshair size={13} />
              </button>
            </div>
            {r.matches.map((m) => (
              <button
                type="button"
                key={`${m.lineNumber}:${m.matchIndex}`}
                className="search-match"
                data-search-row
                onClick={() => onOpenResult(r.path, query, m.lineNumber, m.matchIndex)}
                title={getLang() === 'en' ? `Line ${m.lineNumber}` : `第 ${m.lineNumber} 行`}
              >
                {highlight(m.text, query)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
