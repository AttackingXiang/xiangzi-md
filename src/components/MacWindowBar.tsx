import { MapPin, PanelLeft } from 'lucide-react'
import { t } from '../lib/i18n'
import { shortcutHint } from '../lib/shortcuts'
import { runWindowAction } from '../lib/windowActions'
import { handleWindowDragPointerDown, isWindowDragInteractiveTarget } from '../lib/windowDragRegion'

interface Props {
  onToggleSidebar: () => void
  onRevealFile?: () => void
  activeHasPath?: boolean
  showRevealButton?: boolean
}

export default function MacWindowBar({
  onToggleSidebar,
  onRevealFile,
  activeHasPath = false,
  showRevealButton = true,
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
      <button
        className="icon-btn sm"
        title={`${t('切换侧边栏')} (${shortcutHint('Mod+\\')})`}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={15} />
      </button>

      {showRevealButton && onRevealFile && activeHasPath && (
        <button className="icon-btn sm" title={t('在文件夹中定位')} onClick={onRevealFile}>
          <MapPin size={15} />
        </button>
      )}
    </div>
  )
}
