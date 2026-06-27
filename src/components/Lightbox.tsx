import { useEffect } from 'react'

interface Props {
  src: string
  onClose: () => void
}

/** 图片放大预览：点击任意处或按 Esc 关闭 */
export default function Lightbox({ src, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <img className="lightbox-img" src={src} alt="" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
