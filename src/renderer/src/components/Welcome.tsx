import { FilePlus2, FolderOpen, FileText, Clock, Folder } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  recentFiles: string[]
  recentFolders: string[]
  onOpenFolder: () => void
  onOpenFile: () => void
  onNewFile: () => void
  onOpenRecentFile: (path: string) => void
  onOpenRecentFolder: (path: string) => void
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '' : p.slice(0, i)
}

export default function Welcome({
  recentFiles,
  recentFolders,
  onOpenFolder,
  onOpenFile,
  onNewFile,
  onOpenRecentFile,
  onOpenRecentFolder
}: Props): JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <div className="welcome-logo">M</div>
          <div>
            <h1>Xiangzi MD</h1>
            <p className="welcome-sub">{t('所见即所得的 Markdown 编辑器')}</p>
          </div>
        </div>

        <div className="welcome-actions">
          <button className="action-card" onClick={onNewFile}>
            <FilePlus2 size={18} />
            <span>{t('新建文件')}</span>
          </button>
          <button className="action-card" onClick={onOpenFile}>
            <FileText size={18} />
            <span>{t('打开文件')}</span>
          </button>
          <button className="action-card" onClick={onOpenFolder}>
            <FolderOpen size={18} />
            <span>{t('打开文件夹')}</span>
          </button>
        </div>

        <div className="welcome-recents">
          {recentFiles.length > 0 && (
            <div className="recent-col">
              <div className="recent-title">
                <Clock size={14} /> {t('最近文件')}
              </div>
              {recentFiles.slice(0, 8).map((p) => (
                <div key={p} className="recent-item" title={p} onClick={() => onOpenRecentFile(p)}>
                  <FileText size={14} />
                  <span className="recent-name">{baseName(p)}</span>
                  <span className="recent-dir">{parentDir(p)}</span>
                </div>
              ))}
            </div>
          )}

          {recentFolders.length > 0 && (
            <div className="recent-col">
              <div className="recent-title">
                <Folder size={14} /> {t('最近文件夹')}
              </div>
              {recentFolders.slice(0, 8).map((p) => (
                <div key={p} className="recent-item" title={p} onClick={() => onOpenRecentFolder(p)}>
                  <Folder size={14} />
                  <span className="recent-name">{baseName(p)}</span>
                  <span className="recent-dir">{parentDir(p)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
