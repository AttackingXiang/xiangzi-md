import { Circle, Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import TitleBarMenu from './TitleBarMenu'
import { currentDesktopPlatform } from '../lib/platform'
import { t } from '../lib/i18n'
import { isTauriRuntime } from '../platform'
import { runWindowAction, startWindowDragging, watchWindowMaximized } from '../lib/windowActions'

const EMPTY_SHORTCUTS: Record<string, string> = {}

interface Props {
  documentName?: string
  dirty?: boolean
  shortcuts?: Record<string, string>
  onOpenAbout?: () => void
  onAddProperty?: () => void
  canAddProperty?: boolean
}

export default function TitleBar({
  documentName,
  dirty = false,
  shortcuts = EMPTY_SHORTCUTS,
  onOpenAbout,
  onAddProperty,
  canAddProperty = false,
}: Props): JSX.Element {
  const platform = currentDesktopPlatform()
  const isMac = platform === 'macos'
  const [maximized, setMaximized] = useState(false)

  // 只有非 mac 才自绘窗口控件；mac 用系统交通灯。
  useEffect(() => {
    if (isMac || !isTauriRuntime()) return undefined
    let unwatch: (() => void) | null = null
    let disposed = false
    void watchWindowMaximized(setMaximized)
      .then((stop) => {
        if (disposed) stop()
        else unwatch = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unwatch?.()
    }
  }, [isMac])

  return (
    <header
      className={`titlebar ${isMac ? 'titlebar-mac' : 'titlebar-standard'}`}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest('[data-titlebar-interactive]'))
        )
          return
        // Not gated on event.detail: PointerEvent.detail is spec-optional and
        // Chromium/WebView2 (Windows) reports 0 rather than a click count, so
        // requiring `=== 1` silently blocked every drag on Windows. Starting
        // a drag on a double-click's second press is harmless — there's no
        // pointer movement between clicks, so nothing actually moves, and
        // the separate onDoubleClick handler below still fires normally.
        void startWindowDragging().catch((error: unknown) =>
          console.error('Window dragging failed', error),
        )
      }}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-titlebar-interactive]'))
          return
        event.preventDefault()
        event.stopPropagation()
        void runWindowAction('maximize').catch((error: unknown) =>
          console.error('Window maximize failed', error),
        )
      }}
    >
      {!isMac && (
        <TitleBarMenu
          shortcuts={shortcuts}
          onOpenAbout={onOpenAbout ?? (() => {})}
          onAddProperty={onAddProperty}
          canAddProperty={canAddProperty}
        />
      )}

      {!isMac && (
        <div className="titlebar-controls" data-titlebar-interactive aria-label={t('窗口控制')}>
          <>
            <WindowButton label={t('最小化窗口')} onClick={() => runWindowAction('minimize')}>
              <Minus size={15} />
            </WindowButton>
            <WindowButton
              label={maximized ? t('还原窗口') : t('最大化窗口')}
              onClick={() => runWindowAction('maximize')}
            >
              {maximized ? <Copy size={12} /> : <Square size={12} />}
            </WindowButton>
            <WindowButton
              kind="close"
              label={t('关闭窗口')}
              onClick={() => runWindowAction('close')}
            >
              <X size={15} />
            </WindowButton>
          </>
        </div>
      )}

      <div className="titlebar-title">
        {documentName ? (
          <>
            <span className="titlebar-document-name">{documentName}</span>
            {dirty && (
              <Circle
                className="titlebar-dirty"
                size={6}
                fill="currentColor"
                aria-label={t('未保存')}
              />
            )}
          </>
        ) : (
          <span className="titlebar-app-name">Xiangzi MD</span>
        )}
      </div>
    </header>
  )
}

function WindowButton({
  children,
  kind = 'default',
  label,
  onClick,
}: {
  children: ReactNode
  kind?: 'default' | 'close' | 'minimize' | 'maximize'
  label: string
  onClick: () => Promise<void>
}): JSX.Element {
  return (
    <button
      type="button"
      className={`titlebar-button titlebar-button-${kind}`}
      aria-label={label}
      title={label}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        void onClick().catch((error: unknown) => console.error('Window action failed', error))
      }}
    >
      {children}
    </button>
  )
}
