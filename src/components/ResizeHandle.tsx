import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { t } from '../lib/i18n'

interface Props {
  label: string
  /** 拖动方向：1 表示手柄在面板右侧（往右拖变宽），-1 表示在左侧。 */
  direction: 1 | -1
  width: number
  onResizeStart: (event: ReactMouseEvent) => void
  /** 双击复位到默认宽度。 */
  onReset: () => void
  /** 键盘微调（每次 ±16px），让宽度不再是鼠标独占的操作。 */
  onNudge: (delta: number) => void
}

const NUDGE_STEP = 16

/** 面板之间的拖拽条。除了鼠标拖动，还支持双击复位和方向键微调。 */
export default function ResizeHandle({
  label,
  direction,
  width,
  onResizeStart,
  onReset,
  onNudge,
}: Props): JSX.Element {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const towardsWider = event.key === 'ArrowRight' ? 1 : -1
    onNudge(towardsWider * direction * NUDGE_STEP)
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} (${t('双击恢复默认宽度')})`}
      aria-valuenow={width}
      tabIndex={0}
      onMouseDown={onResizeStart}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
