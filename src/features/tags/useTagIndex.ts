import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktop } from '../../platform'
import { mapWithConcurrencyLimit } from '../../lib/asyncPool'
import { documentMetaFromMarkdown, MARKDOWN_EXTENSION_RE, tagKey } from './frontmatter'
import type { DocumentMeta, TagIndex } from './types'

const SCAN_CONCURRENCY = 4

/** 增量扫描缓存里的一条记录：某个路径在某个 mtime 下解析出的 meta。 */
export interface TagScanCacheEntry {
  modifiedNanos: number
  meta: DocumentMeta
}

export type TagScanCache = Map<string, TagScanCacheEntry>

/** listFiles 返回项里，增量扫描决策实际用到的字段。 */
export interface ListedScanFile {
  path: string
  name: string
  modifiedNanos: number
}

export interface ScanPlan {
  /** 缓存命中（mtime 相等）、可直接复用、不需要 readFile 的文档。 */
  cached: DocumentMeta[]
  /** 缓存未命中（新文件 或 mtime 变了）、需要 readFile 重新解析的文件。 */
  toRead: Array<{ path: string; name: string }>
  /** 缓存里存在、但本次列表已经没有的路径——文件被删除/移走，扫描收尾时应从缓存剔除，
   * 否则缓存会随着文件增删无限增长。 */
  stalePaths: string[]
}

/** 根据本次 listFiles 结果与已有缓存，纯函数地决定“谁能直接复用、谁要重读、谁该从
 * 缓存里剔除”。不依赖 React/IO，方便单测覆盖增量决策本身。
 *
 * 判定“未变”用的是 mtime **相等**，而不是“缓存值 <= 本次列出的值”这种更宽松的判断：
 * mtime 可能因为 git checkout、时间同步、从别处复制回一份旧文件等操作而变小（倒退），
 * 不只是单调变大。只要跟缓存记录的不一致（无论变大变小），内容就可能已经不同，
 * 必须重读；只有严格相等才能安全地跳过 IPC 全文传输。
 */
export function planScan(files: readonly ListedScanFile[], cache: TagScanCache): ScanPlan {
  const cached: DocumentMeta[] = []
  const toRead: Array<{ path: string; name: string }> = []
  const listedPaths = new Set<string>()
  for (const file of files) {
    listedPaths.add(file.path)
    const entry = cache.get(file.path)
    if (entry && entry.modifiedNanos === file.modifiedNanos) {
      cached.push(entry.meta)
    } else {
      toRead.push({ path: file.path, name: file.name })
    }
  }
  const stalePaths: string[] = []
  for (const path of cache.keys()) {
    if (!listedPaths.has(path)) stalePaths.push(path)
  }
  return { cached, toRead, stalePaths }
}

export function useTagIndex(root: string | null, reloadKey: number) {
  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const scanIdRef = useRef(0)
  const previousRootRef = useRef<string | null>(null)
  // path -> 上次读到的 mtime + 解析出的 meta。key 用 path 而不是 name 或
  // path+mtime 组合：path 在一次会话内唯一标识一个文件，重命名/移动会产生
  // 新 path（旧 path 随后在 stalePaths 里被剔除），mtime 只是判断"要不要重读"
  // 的附加条件，不需要也不应该参与 key（否则同一文件 mtime 一变就会在 Map
  // 里留下一条永远用不到的旧记录，缓存只增不减）。
  const cacheRef = useRef<TagScanCache>(new Map())

  const refresh = useCallback((): void => setRefreshVersion((value) => value + 1), [])

  useEffect(() => {
    const scanId = ++scanIdRef.current
    // 只有 root 真的换了（切换文件夹）才清空，避免 reloadKey/refreshVersion
    // 触发的同文件夹重扫也跟着闪一下空列表。root 从一个文件夹切到另一个时，
    // 不清空的话会在新文件夹的扫描结果回来之前，一直显示旧文件夹的标签/文档。
    const rootChanged = previousRootRef.current !== root
    previousRootRef.current = root
    if (!root) {
      setDocuments([])
      setLoading(false)
      setError(null)
      return
    }
    if (rootChanged) {
      setDocuments([])
      // 换了工作区，旧缓存对新目录没有意义（甚至可能因为相对路径巧合撞 key），
      // 必须清空，否则新目录的首次扫描会错误地"复用"另一个仓库的 meta。
      cacheRef.current.clear()
    }
    setLoading(true)
    setError(null)
    void desktop
      .listFiles(root)
      .then((files) => files.filter((file) => MARKDOWN_EXTENSION_RE.test(file.name)))
      .then(async (files) => {
        const { cached, toRead, stalePaths } = planScan(files, cacheRef.current)
        const read = await mapWithConcurrencyLimit(toRead, SCAN_CONCURRENCY, async (file) => {
          try {
            const opened = await desktop.readFile(file.path)
            const meta = documentMetaFromMarkdown(
              opened.path,
              opened.name,
              opened.content,
              opened.version.modifiedNanos,
            )
            // 缓存里记的是 readFile 实际返回的版本，而不是 listFiles 那次的 mtime——
            // "列出文件"和"读取内容"之间文件可能又被改了一次，用读到时的版本才不会
            // 把新内容误记成旧 mtime（导致下次扫描误判为"没变"而跳过重读）。
            //
            // 这次写入不看 scanId 是否仍是最新：无论本次扫描是否已被更晚触发的扫描
            // 超越，这里记的都是刚刚真实读到的磁盘内容，天然幂等、随时可信，写入
            // 缓存没有风险。
            cacheRef.current.set(opened.path, {
              modifiedNanos: opened.version.modifiedNanos,
              meta,
            })
            return meta
          } catch {
            return null
          }
        })
        // 剔除操作则必须挡在 scanId 检查之后：本次的文件列表可能已经过时——如果
        // 有更晚触发的扫描先一步完成并往缓存里写入了新文件，而本次（更旧的）列表
        // 里自然不包含那个新文件，此时若不看 scanId 直接剔除"listedPaths 之外的
        // path"，就会把新扫描刚写入的有效缓存误删。scanId 已过期就放弃剔除，
        // 留给最新那次扫描来做。
        if (scanId === scanIdRef.current) {
          for (const path of stalePaths) cacheRef.current.delete(path)
        }
        return [...cached, ...read]
      })
      .then((items) => {
        if (scanId !== scanIdRef.current) return
        setDocuments(
          items
            .filter((item): item is DocumentMeta => item !== null)
            .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title)),
        )
      })
      .catch((reason: unknown) => {
        if (scanId !== scanIdRef.current) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (scanId === scanIdRef.current) setLoading(false)
      })
  }, [reloadKey, refreshVersion, root])

  /**
   * 把一份已知的最新 meta 直接并入索引，跳过整仓重扫（用于保存/改名等我们手上
   * 已经拿到确定新内容的场景）。
   *
   * modifiedNanos 是可选的第二参数：
   * - 传了：说明调用方手上是"已经落盘"的版本（比如刚 writeFile 拿到的
   *   result.version.modifiedNanos），同步写入缓存，下次重扫命中缓存、不必
   *   再读一遍这个刚保存的文件。
   * - 不传：说明这只是内存里的编辑缓冲（未保存的新文档，或调用方并不确定
   *   对应的磁盘 mtime），此时故意不碰缓存——缓存只应该记录"确定对应磁盘上
   *   某个 mtime"的内容，留空则下次扫描会照常重读该文件，这是正确行为而不是
   *   遗漏。
   */
  const upsertDocument = useCallback((document: DocumentMeta, modifiedNanos?: number): void => {
    if (modifiedNanos !== undefined) {
      cacheRef.current.set(document.path, { modifiedNanos, meta: document })
    }
    setDocuments((current) => {
      const withoutCurrent = current.filter((item) => item.path !== document.path)
      return [...withoutCurrent, document].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title),
      )
    })
  }, [])

  const { tagIndex, tagLabels } = useMemo(() => {
    const index: TagIndex = {}
    const labels: Record<string, string> = {}
    for (const document of documents) {
      for (const tag of document.tags) {
        const key = tagKey(tag)
        if (!key) continue
        labels[key] ??= tag
        ;(index[key] ??= []).push(document)
      }
    }
    return { tagIndex: index, tagLabels: labels }
  }, [documents])

  return { documents, tagIndex, tagLabels, loading, error, refresh, upsertDocument }
}
