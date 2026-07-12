import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, Search } from 'lucide-react'
import { desktop } from '../platform'
import type { SearchResult } from '../types'
import { t, getLang } from '../lib/i18n'

interface Props {
  root: string
  onOpenResult: (path: string, query: string, lineNumber?: number, matchIndex?: number) => void
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

export default function SearchPanel({ root, onOpenResult, onBack }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchMeta, setSearchMeta] = useState({
    scannedFiles: 0,
    totalMatches: 0,
    truncated: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 防抖搜索
  useEffect(() => {
    const id = ++reqId.current
    setError(null)
    if (!query.trim()) {
      setResults([])
      setSearchMeta({ scannedFiles: 0, totalMatches: 0, truncated: false })
      setLoading(false)
      void desktop.cancelSearch()
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      void desktop
        .searchInFolder(root, query)
        .then((response) => {
          if (id === reqId.current && !response.cancelled) {
            setResults(response.items)
            setSearchMeta({
              scannedFiles: response.scannedFiles,
              totalMatches: response.totalMatches,
              truncated: response.truncated,
            })
          }
        })
        .catch(() => {
          if (id === reqId.current) {
            setResults([])
            setSearchMeta({ scannedFiles: 0, totalMatches: 0, truncated: false })
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
  }, [query, root])

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

      <div className="search-meta">
        {error ??
          (loading
            ? t('搜索中…')
            : query.trim()
              ? getLang() === 'en'
                ? `${results.length} files, ${searchMeta.totalMatches} matches${searchMeta.truncated ? ` (truncated after ${searchMeta.scannedFiles} files)` : ''}`
                : `${results.length} 个文件，${searchMeta.totalMatches} 处匹配${searchMeta.truncated ? `（扫描 ${searchMeta.scannedFiles} 个文件后已截断）` : ''}`
              : '')}
      </div>

      <div className="sidebar-body">
        {results.map((r) => (
          <div key={r.path} className="search-file">
            <div className="search-file-head" title={r.path}>
              <FileText size={14} />
              <span className="search-file-name">{r.name}</span>
              <span className="search-count">{r.matches.length}</span>
            </div>
            {r.matches.map((m, i) => (
              <div
                key={i}
                className="search-match"
                onClick={() => onOpenResult(r.path, query, m.lineNumber, m.matchIndex)}
                title={getLang() === 'en' ? `Line ${m.lineNumber}` : `第 ${m.lineNumber} 行`}
              >
                {highlight(m.text, query)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
