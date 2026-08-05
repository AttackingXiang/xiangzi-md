import { FileText, FolderOpen } from 'lucide-react'
import { t } from '../lib/i18n'
import { useModalFocus } from '../hooks/useModalFocus'

export type ClipboardPathKind = 'file' | 'folder'

interface Props {
  path: string
  kind: ClipboardPathKind
  onOpen: () => void
  onClose: () => void
}

export default function ClipboardPathDialog({ path, kind, onOpen, onClose }: Props): JSX.Element {
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal clipboard-path-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clipboard-path-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span id="clipboard-path-title">{t('检测到可打开路径')}</span>
        </div>
        <div className="modal-body">
          <div className="clipboard-path-message">
            {kind === 'file' ? <FileText size={20} /> : <FolderOpen size={20} />}
            <span>{t('剪切板中有一个可打开的路径，是否要打开？')}</span>
          </div>
          <div className="clipboard-path-value" title={path}>
            {path}
          </div>
          <div className="clipboard-path-actions">
            <button className="secondary-btn" onClick={onClose}>
              {t('取消')}
            </button>
            <button className="primary-btn" onClick={onOpen}>
              {kind === 'file' ? <FileText size={15} /> : <FolderOpen size={15} />}
              {t('打开')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
