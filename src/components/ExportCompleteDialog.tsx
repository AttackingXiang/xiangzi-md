import { CheckCircle2, FolderOpen } from 'lucide-react'
import { t } from '../lib/i18n'
import ModalShell from './ModalShell'

interface Props {
  path: string
  onConfirm: () => void
  onReveal: () => void
}

export default function ExportCompleteDialog({ path, onConfirm, onReveal }: Props): JSX.Element {
  return (
    <ModalShell
      className="modal export-complete-dialog"
      labelledBy="export-complete-title"
      onBackdrop={onConfirm}
      onEscape={onConfirm}
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
        <button className="secondary-btn" onClick={onConfirm}>
          {t('确认')}
        </button>
        <button className="primary-btn" onClick={onReveal}>
          <FolderOpen size={15} />
          {t('打开所在文件夹')}
        </button>
      </div>
    </ModalShell>
  )
}
