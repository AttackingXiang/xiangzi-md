import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktop } from '../../platform'
import { mapWithConcurrencyLimit } from '../../lib/asyncPool'
import { documentMetaFromMarkdown, tagKey } from './frontmatter'
import type { DocumentMeta, TagIndex } from './types'

const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown|mdown|mkd|mdx)$/i
const SCAN_CONCURRENCY = 4

export function useTagIndex(root: string | null, reloadKey: number) {
  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const scanIdRef = useRef(0)
  const previousRootRef = useRef<string | null>(null)

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
    if (rootChanged) setDocuments([])
    setLoading(true)
    setError(null)
    void desktop
      .listFiles(root)
      .then((files) => files.filter((file) => MARKDOWN_EXTENSION_RE.test(file.name)))
      .then((files) =>
        mapWithConcurrencyLimit(files, SCAN_CONCURRENCY, async (file) => {
          try {
            const opened = await desktop.readFile(file.path)
            return documentMetaFromMarkdown(
              opened.path,
              opened.name,
              opened.content,
              opened.version.modifiedNanos,
            )
          } catch {
            return null
          }
        }),
      )
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

  const upsertDocument = useCallback((document: DocumentMeta): void => {
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
