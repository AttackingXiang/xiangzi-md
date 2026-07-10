import { FilePlus2, FolderOpen, FileText, Clock, Folder, RotateCcw, Tag } from 'lucide-react'
import { t } from '../lib/i18n'
import { baseName, dirName } from '../lib/path'
import appIcon from '../../src-tauri/icons/icon.png'

interface Props {
  recentFiles: string[]
  recentFolders: string[]
  pinnedTags: string[]
  tagLabels: Record<string, string>
  onOpenFolder: () => void
  onOpenFile: () => void
  onNewFile: () => void
  onOpenRecentFile: (path: string) => void
  onOpenRecentFolder: (path: string) => void
  onOpenPinnedTag: (tag: string) => void
  draftCount?: number
  onOpenDrafts?: () => void
}

/**
 * The parent directory, shortened for display: when it has more than a couple
 * of segments, the leading ones collapse to an ellipsis so only the closest
 * folders (the useful, distinguishing part) stay visible. The full path is kept
 * in the row's `title`.
 */
function parentDir(p: string): string {
  const dir = dirName(p) ?? ''
  if (dir.length <= 36) return dir
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  const segs = dir.split(/[\\/]/).filter(Boolean)
  if (segs.length <= 2) return dir
  return '…' + sep + segs.slice(-2).join(sep)
}

export default function Welcome({
  recentFiles,
  recentFolders,
  pinnedTags,
  tagLabels,
  onOpenFolder,
  onOpenFile,
  onNewFile,
  onOpenRecentFile,
  onOpenRecentFolder,
  onOpenPinnedTag,
  draftCount = 0,
  onOpenDrafts,
}: Props): JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div className="welcome-brand">
            <div className="welcome-logo" aria-hidden="true">
              <img src={appIcon} alt="" />
            </div>
            <h1>Xiangzi MD</h1>
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
        </div>

        {draftCount > 0 && onOpenDrafts && (
          <button className="draft-recovery-banner" onClick={onOpenDrafts}>
            <RotateCcw size={16} />
            <span>{t('有可恢复的草稿')}</span>
            <strong>{draftCount}</strong>
          </button>
        )}

        {pinnedTags.length > 0 && (
          <div className="welcome-favorites">
            <div className="recent-title">
              <Tag size={14} /> {t('收藏标签')}
            </div>
            <div className="favorite-tag-list">
              {pinnedTags.map((tag) => (
                <button
                  key={tag}
                  className="favorite-tag-chip"
                  title={tagLabels[tag] ?? tag}
                  onClick={() => onOpenPinnedTag(tag)}
                >
                  <Tag size={12} />
                  <span>{tagLabels[tag] ?? tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}

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
                <div
                  key={p}
                  className="recent-item"
                  title={p}
                  onClick={() => onOpenRecentFolder(p)}
                >
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
