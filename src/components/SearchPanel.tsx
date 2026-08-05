import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, Search } from 'lucide-react'
import { desktop } from '../platform'
import type { SearchResult } from '../types'
import type { FolderSearchMode, SearchResponse } from '../platform/contracts'
import { t, getLang } from '../lib/i18n'

interface Props {
  root: string
  /** 文件树变化或已打开文件保存后变化，用于清理旧搜索结果。 */
  reloadKey: string
  /** Incremented when the folder-search shortcut should return focus here. */
  focusRequest?: number
  onOpenResult: (path: string, query: string, lineNumber?: number, matchIndex?: number) => void
  onOpenFile: (path: string) => void
  onBack: () => void
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
  root,
  reloadKey,
  focusRequest = 0,
  onOpenResult,
  onOpenFile,
  onBack,
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<FolderSearchMode>('all')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchMeta, setSearchMeta] = useState<{
    scannedFiles: number
    totalMatches: number
    truncated: boolean
    reason: SearchResponse['reason']
  }>({
    scannedFiles: 0,
    totalMatches: 0,
    truncated: false,
    reason: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusRequest])

  // 查询条件本身变了，旧结果立刻作废，先清空避免展示不匹配的内容。
  // reloadKey 变化不走这里：那只是文件落盘后的后台重新校验，清空会让列表闪一下白。
  useEffect(() => {
    setResults([])
    setSearchMeta({ scannedFiles: 0, totalMatches: 0, truncated: false, reason: null })
  }, [mode, query, root])

  // 防抖搜索
  useEffect(() => {
    const id = ++reqId.current
    setError(null)
    if (!query.trim()) {
      setLoading(false)
      void desktop.cancelSearch()
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      void desktop
        .searchInFolder(root, query, mode)
        .then((response) => {
          if (id === reqId.current && !response.cancelled) {
            setResults(response.items)
            setSearchMeta({
              scannedFiles: response.scannedFiles,
              totalMatches: response.totalMatches,
              truncated: response.truncated,
              reason: response.reason,
            })
          }
        })
        .catch(() => {
          if (id === reqId.current) {
            setResults([])
            setSearchMeta({ scannedFiles: 0, totalMatches: 0, truncated: false, reason: null })
            setError(getLang() === 'en' ? 'Search failed. Try again.' : '搜索失败，请重试。')
          }
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      if (reqId.current === id) reqId.current += 1
      void desktop.cancelSearch()
    }
  }, [mode, query, reloadKey, root])

  const en = getLang() === 'en'
  const summary = en
    ? `${results.length} files, ${searchMeta.totalMatches} matches`
    : `${results.length} 个文件，${searchMeta.totalMatches} 处匹配`

  // 后端截断时把「为什么」也说清楚。三种上限对用户的含义完全不同：
  // 缩小目录、加精确关键词、还是打开文件自己找——一句"已截断"帮不上忙。
  const truncationHint = !searchMeta.truncated
    ? null
    : searchMeta.reason === 'file_limit'
      ? en
        ? `Stopped after scanning ${searchMeta.scannedFiles} files. Narrow the folder to see the rest.`
        : `扫描 ${searchMeta.scannedFiles} 个文件后停止，缩小目录范围可以看到其余结果。`
      : searchMeta.reason === 'per_file_limit'
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

  return (
    <aside className="sidebar search-panel">
      <div className="sidebar-header">
        <button className="icon-btn sm" title={t('返回文件')} onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <span className="sidebar-title">{t('搜索')}</span>
        <span />
      </div>

      <div className="search-input-wrap">
        <Search size={14} />
        <input
          ref={inputRef}
          className="search-field"
          placeholder={t('在文件夹中搜索…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
          <p className="sidebar-empty search-empty">{t('输入关键词开始搜索当前文件夹。')}</p>
        )}
        {!loading && !error && query.trim() && results.length === 0 && (
          <p className="sidebar-empty search-empty">{t('没有找到匹配的内容。')}</p>
        )}
        {results.map((r) => (
          <div key={r.path} className="search-file">
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
    </aside>
  )
}
