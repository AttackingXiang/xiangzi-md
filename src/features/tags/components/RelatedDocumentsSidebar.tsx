import { ArrowLeft, Search, Tag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DocumentMeta } from '../types'
import RelatedDocumentItem from './RelatedDocumentItem'
import { getLang, t } from '../../../lib/i18n'

interface Props {
  tag: string
  documents: DocumentMeta[]
  activePath: string | null
  folderName: string | null
  loading: boolean
  error: string | null
  onBack: () => void
  onOpenDocument: (path: string, name: string) => void
}

export default function RelatedDocumentsSidebar({
  tag,
  documents,
  activePath,
  folderName,
  loading,
  error,
  onBack,
  onOpenDocument,
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  useEffect(() => setQuery(''), [tag])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return documents
    return documents.filter((document) =>
      `${document.title}\n${document.excerpt}\n${document.path}`
        .toLocaleLowerCase()
        .includes(needle),
    )
  }, [documents, query])

  const emptyHint =
    getLang() === 'en'
      ? folderName
        ? `No documents tagged #${tag} in "${folderName}"`
        : `No documents tagged #${tag}`
      : folderName
        ? `在「${folderName}」下没有找到 #${tag} 的关联文档`
        : `没有找到 #${tag} 的关联文档`

  return (
    <div className="tag-panel tag-related-panel">
      <div className="tag-sidebar-heading">
        <button type="button" className="tag-sidebar-back" onClick={onBack}>
          <ArrowLeft size={14} />
          {t('返回标签')}
        </button>
        <div className="tag-sidebar-title">
          <Tag size={18} />
          <strong>{getLang() === 'en' ? `Tag: ${tag}` : `标签：${tag}`}</strong>
        </div>
        <span className="tag-sidebar-count">
          {getLang() === 'en' ? `${documents.length} documents` : `共 ${documents.length} 篇文档`}
        </span>
      </div>
      <label className="tag-search-wrap">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('搜索该标签下的文档…')}
          aria-label={t('搜索该标签下的文档…')}
        />
      </label>
      <div className="tag-related-list">
        {error ? (
          <div className="tag-sidebar-state tag-sidebar-error">{t('标签索引加载失败')}</div>
        ) : loading && documents.length === 0 ? (
          <div className="tag-sidebar-state">{t('正在加载标签索引')}</div>
        ) : filtered.length === 0 ? (
          <div className="tag-sidebar-state">{query ? t('没有匹配的文档') : emptyHint}</div>
        ) : (
          filtered.map((document) => (
            <RelatedDocumentItem
              key={document.path}
              document={document}
              active={document.path === activePath}
              onOpen={() => onOpenDocument(document.path, document.name)}
            />
          ))
        )}
      </div>
    </div>
  )
}
