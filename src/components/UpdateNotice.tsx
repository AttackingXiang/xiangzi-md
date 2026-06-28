import { ArrowDownToLine, CheckCircle2, RefreshCw, X } from 'lucide-react'
import type { UpdaterController } from '../hooks/useUpdater'
import { getLang } from '../lib/i18n'
import { extractUpdateHighlights } from '../lib/updateNotes'

interface Props {
  updater: UpdaterController
}

export default function UpdateNotice({ updater }: Props): JSX.Element | null {
  const { state } = updater
  if (!['available', 'downloading'].includes(state.phase)) return null
  const en = getLang() === 'en'
  const downloading = state.phase === 'downloading'
  const highlights = extractUpdateHighlights(state.notes)

  return (
    <div className="modal-backdrop update-backdrop" role="presentation">
      <section
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <header className="modal-header">
          <span id="update-title">{en ? 'Update available' : '发现新版本'}</span>
          {!downloading && (
            <button
              className="icon-btn sm"
              aria-label={en ? 'Later' : '稍后'}
              onClick={updater.dismiss}
            >
              <X size={16} />
            </button>
          )}
        </header>
        <div className="update-content">
          <div className="update-icon" aria-hidden="true">
            {downloading ? <RefreshCw size={22} /> : <ArrowDownToLine size={22} />}
          </div>
          <div className="update-copy">
            <h2>Xiangzi MD {state.version}</h2>
            <p className="update-meta">
              {state.currentVersion
                ? en
                  ? `Update from ${state.currentVersion}`
                  : `从 ${state.currentVersion} 更新`
                : en
                  ? 'A new version is ready'
                  : '新版本已准备好'}
            </p>
            {highlights.length > 0 && (
              <section className="update-notes" aria-label={en ? "What's new" : '本次更新'}>
                <h3>{en ? "What's new" : '本次更新'}</h3>
                <ul>
                  {highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
        {downloading ? (
          <div className="update-progress" aria-live="polite">
            <progress max={100} value={state.progress} />
            <span>
              {state.progress === undefined
                ? en
                  ? 'Downloading…'
                  : '正在下载…'
                : `${state.progress}%`}
            </span>
          </div>
        ) : (
          <footer className="modal-actions">
            <button className="secondary-btn" onClick={updater.dismiss}>
              {en ? 'Later' : '稍后'}
            </button>
            <button className="primary-btn" onClick={() => void updater.install()}>
              <CheckCircle2 size={15} />
              {en ? 'Update and restart' : '更新并重启'}
            </button>
          </footer>
        )}
      </section>
    </div>
  )
}
