import { Circle, Minus, Square, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ReactNode } from 'react'
import { currentDesktopPlatform } from '../lib/platform'
import { t } from '../lib/i18n'

interface Props {
  documentName?: string
  dirty?: boolean
}

async function runWindowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  const window = getCurrentWindow()
  if (action === 'minimize') await window.minimize()
  else if (action === 'maximize') await window.toggleMaximize()
  else await window.close()
}

export default function TitleBar({ documentName, dirty = false }: Props): JSX.Element {
  const platform = currentDesktopPlatform()
  const isMac = platform === 'macos'

  return (
    <header
      className={`titlebar ${isMac ? 'titlebar-mac' : 'titlebar-standard'}`}
      data-tauri-drag-region
      onDoubleClick={() =>
        void runWindowAction('maximize').catch((error: unknown) =>
          console.error('Window maximize failed', error),
        )
      }
    >
      {!isMac && (
        <div className="titlebar-controls" aria-label={t('窗口控制')}>
          <>
            <WindowButton label={t('最小化窗口')} onClick={() => runWindowAction('minimize')}>
              <Minus size={15} />
            </WindowButton>
            <WindowButton label={t('最大化或还原窗口')} onClick={() => runWindowAction('maximize')}>
              <Square size={12} />
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

      <div className="titlebar-title" data-tauri-drag-region>
        <span className="titlebar-app-name">Xiangzi MD</span>
        {documentName && (
          <>
            <span className="titlebar-separator" aria-hidden="true">
              /
            </span>
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
