import { FileText } from 'lucide-react'
import { getLang } from '../../../lib/i18n'
import type { DocumentMeta } from '../types'
import TagChip from './TagChip'

interface Props {
  document: DocumentMeta
  active: boolean
  onOpen: () => void
}

function relativeUpdatedAt(timestamp: number): string {
  if (!timestamp) return ''
  const en = getLang() === 'en'
  const elapsed = Date.now() - timestamp
  const day = 24 * 60 * 60 * 1000
  if (elapsed < 0 || elapsed < day) return en ? 'Today' : '今天'
  if (elapsed < day * 2) return en ? 'Yesterday' : '昨天'
  if (elapsed < day * 7) {
    const days = Math.floor(elapsed / day)
    return en ? `${days}d ago` : `${days}天前`
  }
  return new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short', day: 'numeric' }).format(
    timestamp,
  )
}

export default function RelatedDocumentItem({ document, active, onOpen }: Props): JSX.Element {
  return (
    <button
      type="button"
      className={`related-document-item${active ? ' active' : ''}`}
      onClick={onOpen}
      title={document.path}
    >
      <span className="related-document-title-row">
        <FileText size={14} />
        <strong>{document.title}</strong>
        <time>{relativeUpdatedAt(document.updatedAt)}</time>
      </span>
      <span className="related-document-excerpt">{document.excerpt || document.path}</span>
      {document.tags.length > 0 && (
        <span className="related-document-tags">
          {document.tags.slice(0, 3).map((tag) => (
            <TagChip key={tag} tag={tag} compact />
          ))}
        </span>
      )}
    </button>
  )
}
