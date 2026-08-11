import { t } from '../lib/i18n'
import { runWindowAction } from '../lib/windowActions'
import { handleWindowDragPointerDown, isWindowDragInteractiveTarget } from '../lib/windowDragRegion'

/**
 * macOS 上左栏顶部的那条空白带。
 *
 * 它只负责给系统红绿灯让出位置、并把这块区域变成窗口拖拽区（双击最大化）。
 * 侧边栏开关和「在文件夹中定位」两颗按钮已经挪到顶部标签栏的最左侧，那里不管
 * 左栏开着还是关着都在同一个位置，不会跟着面板一起消失。
 */
export default function MacWindowBar(): JSX.Element {
  return (
    <div
      className="mac-window-bar"
      aria-label={t('窗口标题栏')}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handleWindowDragPointerDown}
      onDoubleClick={(event) => {
        if (isWindowDragInteractiveTarget(event.target)) return
        event.preventDefault()
        void runWindowAction('maximize').catch((error: unknown) =>
          console.error('Window maximize failed', error),
        )
      }}
    />
  )
}
