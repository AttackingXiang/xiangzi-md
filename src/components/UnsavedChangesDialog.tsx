import { useEffect, useMemo, useState } from 'react'
import { FileWarning, Save } from 'lucide-react'
import { summarizeContentDiff } from '../lib/contentDiff'
import { getLang, t } from '../lib/i18n'
import type { Tab } from '../types'

export type CloseDecision = 'cancel' | 'discard' | 'save'
export type CloseReason = 'close' | 'quit'

interface Props {
  tabs: Tab[]
  reason: CloseReason
  onDecision: (decision: CloseDecision) => void
}

export default function UnsavedChangesDialog({ tabs, reason, onDecision }: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState(tabs[0]?.id ?? '')
  const selected = tabs.find((tab) => tab.id === selectedId) ?? tabs[0]
  const diff = useMemo(
    () => summarizeContentDiff(selected?.savedContent ?? '', selected?.content ?? ''),
    [selected?.content, selected?.savedContent],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDecision('cancel')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDecision])

  const isQuit = reason === 'quit'
  const english = getLang() === 'en'
  return (
    <div className="modal-backdrop unsaved-backdrop" onMouseDown={() => onDecision('cancel')}>
      <section
        className="modal unsaved-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header unsaved-header">
          <span className="unsaved-title-icon" aria-hidden="true">
            <FileWarning size={18} />
          </span>
          <div>
            <div id="unsaved-title">{t('尚未保存修改')}</div>
            <p>
              {tabs.length > 1
                ? english
                  ? `${tabs.length} documents contain unsaved changes.`
                  : `有 ${tabs.length} 个文档包含未保存内容。`
                : english
                  ? `“${selected?.name ?? ''}” contains unsaved changes.`
                  : `「${selected?.name ?? ''}」包含未保存内容。`}
            </p>
          </div>
        </header>

        <div className="unsaved-body">
          {tabs.length > 1 && (
            <nav className="unsaved-tabs" aria-label={t('未保存的文档')}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={tab.id === selected?.id ? 'active' : ''}
                  onClick={() => setSelectedId(tab.id)}
                >
                  <span>{tab.name}</span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </nav>
          )}

          <div className="unsaved-diff-summary">
            <strong>{selected?.name}</strong>
            <span className="diff-added">+{diff.added}</span>
            <span className="diff-removed">−{diff.removed}</span>
            <small>{t('行变更')}</small>
          </div>

          <div className="unsaved-diff" role="region" aria-label={t('未保存的修改预览')}>
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
            {english
              ? isQuit
                ? 'Unsaved changes cannot be recovered after quitting.'
                : 'Unsaved changes cannot be recovered after closing.'
              : isQuit
                ? '退出后，未保存的修改将无法恢复。'
                : '关闭后，未保存的修改将无法恢复。'}
          </p>
        </div>

        <footer className="modal-actions unsaved-actions">
          <button className="secondary-btn" type="button" onClick={() => onDecision('cancel')}>
            {t('取消')}
          </button>
          <button className="danger-btn" type="button" onClick={() => onDecision('discard')}>
            {english
              ? isQuit
                ? 'Quit Without Saving'
                : 'Close Without Saving'
              : isQuit
                ? '不保存并退出'
                : '不保存并关闭'}
          </button>
          <button className="primary-btn" type="button" onClick={() => onDecision('save')}>
            <Save size={15} />
            {english
              ? isQuit
                ? 'Save and Quit'
                : 'Save and Close'
              : isQuit
                ? '保存并退出'
                : '保存并关闭'}
          </button>
        </footer>
      </section>
    </div>
  )
}
