import { useState } from 'react'
import { t } from '../lib/i18n'
import { GRAPHIC_MAX_SCALE, GRAPHIC_MIN_SCALE } from '../lib/lightboxZoom'
import PreviewDialog from './PreviewDialog'

interface Props {
  src: string
  onClose: () => void
}

/** Image and Mermaid viewer with fit-to-window zoom and direct canvas panning. */
export default function Lightbox({ src, onClose }: Props): JSX.Element {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const isMermaid = src.startsWith('data:image/svg+xml')

  return (
    <PreviewDialog
      title={t(isMermaid ? 'Mermaid 预览' : '图片预览')}
      onClose={onClose}
      minScale={GRAPHIC_MIN_SCALE}
      maxScale={GRAPHIC_MAX_SCALE}
      initialTool="pan"
      baseSize={size}
      contentClassName="preview-graphic-content"
      doubleClickZoom
    >
      <img
        className="preview-graphic"
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget
          setSize({
            width: Math.max(1, image.naturalWidth || image.width),
            height: Math.max(1, image.naturalHeight || image.height),
          })
        }}
      />
    </PreviewDialog>
  )
}
