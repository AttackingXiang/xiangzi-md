import { useEffect, useMemo } from 'react'
import { FileWarning } from 'lucide-react'
import { summarizeContentDiff } from '../lib/contentDiff'
import { t } from '../lib/i18n'
import type { OpenedFile } from '../platform/contracts'
import type { Tab } from '../types'

interface Props {
  tab: Tab
  snapshot: OpenedFile
  onCancel: () => void
  onReload: () => void
  onOverwrite: () => void
}

export default function ExternalChangeDialog({
  tab,
  snapshot,
  onCancel,
  onReload,
  onOverwrite,
}: Props): JSX.Element {
  const diff = useMemo(
    () => summarizeContentDiff(tab.content, snapshot.content),
    [snapshot.content, tab.content],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="modal-backdrop unsaved-backdrop" onMouseDown={onCancel}>
      <section
        className="modal unsaved-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-change-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header unsaved-header">
          <span className="unsaved-title-icon" aria-hidden="true">
            <FileWarning size={18} />
          </span>
          <div>
            <div id="external-change-title">{t('外部文件更改')}</div>
            <p>{t('下方显示当前编辑内容与最新磁盘版本之间的差异。')}</p>
          </div>
        </header>

        <div className="unsaved-body">
          <div className="unsaved-diff-summary">
            <strong>{tab.name}</strong>
            <span className="diff-added">+{diff.added}</span>
            <span className="diff-removed">−{diff.removed}</span>
            <small>{t('行变更')}</small>
          </div>
          <div className="unsaved-diff" role="region" aria-label={t('外部更改预览')}>
            {diff.preview.length > 0 ? (
              diff.preview.map((line, index) => (
                <div
                  className={`diff-line ${line.type}`}
                  key={`${line.type}-${line.lineNumber}-${index}`}
                >
                  <span className="diff-sign">{line.type === 'added' ? '+' : '−'}</span>
                  <span className="diff-number">{line.lineNumber}</span>
                  <code>{line.text || ' '}</code>
                </div>
              ))
            ) : (
              <div className="diff-empty">{t('内容格式发生了变化')}</div>
            )}
            {diff.truncated && <div className="diff-more">{t('仅显示部分变更…')}</div>}
          </div>
          <p className="unsaved-warning">
            {t('重新加载会丢弃当前编辑；保留我的版本会覆盖磁盘上的外部更改。')}
          </p>
        </div>

        <footer className="modal-actions unsaved-actions">
          <button className="secondary-btn" type="button" onClick={onCancel}>
            {t('取消')}
          </button>
          <button className="danger-btn" type="button" onClick={onReload}>
            {t('使用磁盘版本')}
          </button>
          <button className="primary-btn" type="button" onClick={onOverwrite}>
            {t('保留我的版本')}
          </button>
        </footer>
      </section>
    </div>
  )
}
