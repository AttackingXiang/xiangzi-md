import { useEffect, useRef } from 'react'
import { CheckCircle2, FolderOpen } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  path: string
  onConfirm: () => void
  onReveal: () => void
}

export default function ExportCompleteDialog({ path, onConfirm, onReveal }: Props): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onConfirm])

  return (
    <div className="modal-backdrop" onMouseDown={onConfirm}>
      <div
        className="modal export-complete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-complete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="export-complete-content">
          <span className="export-complete-icon" aria-hidden="true">
            <CheckCircle2 size={24} />
          </span>
          <div className="export-complete-copy">
            <h2 id="export-complete-title">{t('导出完成')}</h2>
            <p>{t('文件已保存到：')}</p>
            <div className="export-complete-path" title={path}>
              {path}
            </div>
          </div>
        </div>
        <div className="export-complete-actions">
          <button ref={confirmRef} className="secondary-btn" onClick={onConfirm}>
            {t('确认')}
          </button>
          <button className="primary-btn" onClick={onReveal}>
            <FolderOpen size={15} />
            {t('打开所在文件夹')}
          </button>
        </div>
      </div>
    </div>
  )
}
