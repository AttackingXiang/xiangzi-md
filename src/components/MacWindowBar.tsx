import { MapPin, PanelLeft } from 'lucide-react'
import { t } from '../lib/i18n'
import { shortcutHint } from '../lib/shortcuts'
import { runWindowAction } from '../lib/windowActions'
import { handleWindowDragPointerDown, isWindowDragInteractiveTarget } from '../lib/windowDragRegion'

interface Props {
  onToggleSidebar?: () => void
  onRevealFile?: () => void
  showRevealButton?: boolean
  activeHasPath?: boolean
}

/**
 * macOS 上左栏顶部的那条带子：左边给系统红绿灯让出位置，右边贴着侧边栏/结果列
 * 的分隔线放侧边栏开关和「在文件夹中定位」两颗按钮——跟红绿灯同一条带子里，
 * 但不紧挨着它们，而是靠右对齐，跟下面的侧边栏内容、右边的标签栏分成清清楚楚
 * 两块。左栏和结果列都收起时，这条带子不会挂载，这两颗按钮改由标签栏
 * （TabBar）在红绿灯预留区右侧渲染，保持可点、不消失。
 */
export default function MacWindowBar({
  onToggleSidebar,
  onRevealFile,
  showRevealButton = true,
  activeHasPath = false,
}: Props): JSX.Element {
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
    >
      {onToggleSidebar && (
        <button
          type="button"
          className="icon-btn sm"
          title={`${t('切换侧边栏')} (${shortcutHint('Mod+\\')})`}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={15} />
        </button>
      )}

      {showRevealButton && onRevealFile && activeHasPath && (
        <button
          type="button"
          className="icon-btn sm"
          title={t('在文件夹中定位')}
          onClick={onRevealFile}
        >
          <MapPin size={15} />
        </button>
      )}
    </div>
  )
}
