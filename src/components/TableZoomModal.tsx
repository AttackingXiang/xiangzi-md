import { t } from '../lib/i18n'
import { TABLE_MAX_SCALE, TABLE_MIN_SCALE } from '../lib/lightboxZoom'
import PreviewDialog from './PreviewDialog'

interface Props {
  html: string
  onClose: () => void
}

/** Read-only table preview; selection is the default, while the hand tool pans. */
export default function TableZoomModal({ html, onClose }: Props): JSX.Element {
  return (
    <PreviewDialog
      title={t('表格预览')}
      onClose={onClose}
      minScale={TABLE_MIN_SCALE}
      maxScale={TABLE_MAX_SCALE}
      initialTool="select"
      contentClassName="preview-table-content"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </PreviewDialog>
  )
}
