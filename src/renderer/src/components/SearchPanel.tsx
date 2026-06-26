import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, Search } from 'lucide-react'
import type { SearchResult } from '../types'

interface Props {
  root: string
  onOpenResult: (path: string, query: string) => void
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
      </mark>
    )
    i = idx + q.length
  }
  if (!q) parts.push(<span key={key++}>{text}</span>)
  return <>{parts}</>
}

export default function SearchPanel({ root, onOpenResult, onBack }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 防抖搜索
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const id = ++reqId.current
    setLoading(true)
    const timer = setTimeout(async () => {
      const res = await window.api.searchInFolder(root, query)
      if (id === reqId.current) {
        setResults(res)
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, root])

  const totalMatches = results.reduce((n, r) => n + r.matches.length, 0)

  return (
    <aside className="sidebar search-panel">
      <div className="sidebar-header">
        <button className="icon-btn sm" title="返回文件" onClick={onBack}>
          <ArrowLeft size={15} />
        </button>
        <span className="sidebar-title">搜索</span>
        <span />
      </div>

      <div className="search-input-wrap">
        <Search size={14} />
        <input
          ref={inputRef}
          className="search-field"
          placeholder="在文件夹中搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="search-meta">
        {loading ? '搜索中…' : query.trim() ? `${results.length} 个文件，${totalMatches} 处匹配` : ''}
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
                onClick={() => onOpenResult(r.path, query)}
                title={`第 ${m.lineNumber} 行`}
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
