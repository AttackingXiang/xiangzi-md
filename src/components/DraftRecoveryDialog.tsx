import { useEffect } from 'react'
import { FileClock, RotateCcw, Trash2, X } from 'lucide-react'
import type { DraftSummary } from '../types'
import { getLang, t } from '../lib/i18n'

interface Props {
  drafts: DraftSummary[]
  onRecover: (draft: DraftSummary) => void
  onDelete: (draft: DraftSummary) => void
  onDeleteAll: () => void
  onClose: () => void
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en' : 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DraftRecoveryDialog({
  drafts,
  onRecover,
  onDelete,
  onDeleteAll,
  onClose,
}: Props): JSX.Element {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal draft-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-recovery-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header draft-recovery-header">
          <div>
            <h2 id="draft-recovery-title">{t('恢复草稿')}</h2>
            <p>{t('检测到未正常保存的编辑内容，恢复后会作为未保存的新标签打开。')}</p>
          </div>
          <button className="icon-btn sm" onClick={onClose} title={t('关闭')}>
            <X size={15} />
          </button>
        </div>

        <div className="draft-recovery-list">
          {drafts.map((draft) => (
            <article className="draft-recovery-item" key={draft.id}>
              <FileClock size={18} className="draft-recovery-icon" />
              <div className="draft-recovery-copy">
                <strong>{draft.name}</strong>
                <span className="draft-recovery-meta">
                  {formatTime(draft.updatedAt)} · {formatSize(draft.sizeBytes)}
                </span>
                {draft.path && <span className="draft-recovery-path">{draft.path}</span>}
                <p>{draft.preview || t('（空草稿）')}</p>
              </div>
              <div className="draft-recovery-item-actions">
                <button className="secondary-btn" onClick={() => onDelete(draft)}>
                  <Trash2 size={14} />
                  {t('删除')}
                </button>
                <button className="primary-btn" onClick={() => onRecover(draft)}>
                  <RotateCcw size={14} />
                  {t('恢复')}
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="modal-actions draft-recovery-actions">
          <button className="danger-btn" onClick={onDeleteAll}>
            {t('删除全部草稿')}
          </button>
          <button className="secondary-btn" onClick={onClose}>
            {t('稍后处理')}
          </button>
        </div>
      </div>
    </div>
  )
}
