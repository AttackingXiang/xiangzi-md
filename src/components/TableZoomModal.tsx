import { useEffect } from 'react'
import { X } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  html: string
  onClose: () => void
}

/** Full-screen, scrollable, read-only snapshot of the selected table. */
export default function TableZoomModal({ html, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [onClose])

  return (
    <div className="table-zoom-backdrop" onMouseDown={onClose}>
      <div className="table-zoom-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="table-zoom-close" onClick={onClose} title={t('关闭')}>
          <X size={18} />
        </button>
        <div className="table-zoom-scroll">
          <div className="table-zoom-content" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}
