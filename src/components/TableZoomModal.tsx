import { useEffect } from 'react'
import { X } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  html: string
  onClose: () => void
}

/** 「放大展开」弹窗：全屏展示当前表格的静态副本，可双向滚动、只读。 */
export default function TableZoomModal({ html, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="table-zoom-backdrop" onMouseDown={onClose}>
      <div className="table-zoom-panel" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="table-zoom-close" onClick={onClose} title={t('关闭')}>
          <X size={18} />
        </button>
        <div className="table-zoom-scroll milkdown">
          <div
            className="table-zoom-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  )
}
