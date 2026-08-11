import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '../platform'
import type { FolderSearchMode, SearchResponse } from '../platform/contracts'
import type { SearchResult } from '../types'
import { getLang } from '../lib/i18n'

export interface SearchMeta {
  scannedFiles: number
  totalMatches: number
  truncated: boolean
  reason: SearchResponse['reason']
}

const EMPTY_META: SearchMeta = {
  scannedFiles: 0,
  totalMatches: 0,
  truncated: false,
  reason: null,
}

/** 保留多少条最近查询（只在本次会话内，不落盘）。 */
const RECENT_LIMIT = 8

export interface FolderSearchState {
  query: string
  mode: FolderSearchMode
  results: SearchResult[]
  meta: SearchMeta
  loading: boolean
  error: string | null
  recentQueries: string[]
  setQuery: (query: string) => void
  setMode: (mode: FolderSearchMode) => void
  clear: () => void
}

/**
 * 文件夹全文搜索的状态。
 *
 * 之所以住在 App 层而不是 SearchPanel 内部：搜索现在是左栏的一个模式，和文件树
 * 抢同一块位置，「搜索 → 回文件树点开某个文件 → 再搜索」是主路径。状态留在面板里
 * 意味着每次切走都 unmount，回来输入框是空的、结果也没了。提到这里之后，切模式
 * 只是换渲染，查询和结果原样还在。
 *
 * root 为 null（没打开文件夹）时不发起任何请求，但保留已有输入。
 */
export function useFolderSearch(
  root: string | null,
  reloadKey: string,
  initialMode: FolderSearchMode,
  onModeChange: (mode: FolderSearchMode) => void,
): FolderSearchState {
  const [query, setQuery] = useState('')
  const [mode, setModeState] = useState<FolderSearchMode>(initialMode)
  const [results, setResults] = useState<SearchResult[]>([])
  const [meta, setMeta] = useState<SearchMeta>(EMPTY_META)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const reqId = useRef(0)
  const modeTouchedRef = useRef(false)

  // 设置是异步加载的，而这个 hook 在 App 顶层、设置就绪之前就已经跑了一轮。
  // 用户还没手动改过范围时，跟随设置里读出来的值；改过之后就以用户的选择为准。
  useEffect(() => {
    if (!modeTouchedRef.current) setModeState(initialMode)
  }, [initialMode])

  const setMode = useCallback(
    (next: FolderSearchMode): void => {
      modeTouchedRef.current = true
      setModeState(next)
      onModeChange(next)
    },
    [onModeChange],
  )

  const clear = useCallback((): void => {
    setQuery('')
  }, [])

  // 查询条件本身变了，旧结果立刻作废，先清空避免展示不匹配的内容。
  // reloadKey 变化不走这里：那只是文件落盘后的后台重新校验，清空会让列表闪一下白。
  useEffect(() => {
    setResults([])
    setMeta(EMPTY_META)
  }, [mode, query, root])

  // 防抖搜索
  useEffect(() => {
    const id = ++reqId.current
    setError(null)
    if (!root || !query.trim()) {
      setLoading(false)
      void desktop.cancelSearch()
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      void desktop
        .searchInFolder(root, query, mode)
        .then((response) => {
          if (id !== reqId.current || response.cancelled) return
          setResults(response.items)
          setMeta({
            scannedFiles: response.scannedFiles,
            totalMatches: response.totalMatches,
            truncated: response.truncated,
            reason: response.reason,
          })
          // 只有真正跑完一次搜索才记进历史，避免把每个中间击键都存下来。
          const trimmed = query.trim()
          setRecentQueries((previous) =>
            [trimmed, ...previous.filter((item) => item !== trimmed)].slice(0, RECENT_LIMIT),
          )
        })
        .catch(() => {
          if (id !== reqId.current) return
          setResults([])
          setMeta(EMPTY_META)
          setError(getLang() === 'en' ? 'Search failed. Try again.' : '搜索失败，请重试。')
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

  return {
    query,
    mode,
    results,
    meta,
    loading,
    error,
    recentQueries,
    setQuery,
    setMode,
    clear,
  }
}
