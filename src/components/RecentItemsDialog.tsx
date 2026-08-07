import { FileText, Folder, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useModalFocus } from '../hooks/useModalFocus'
import { baseName, dirName } from '../lib/path'
import { t } from '../lib/i18n'

export type RecentItemsSection = 'folders' | 'files'

interface Props {
  recentFiles: string[]
  recentFolders: string[]
  initialSection: RecentItemsSection
  onOpenRecentFile: (path: string) => void | Promise<void>
  onOpenRecentFolder: (path: string) => void | Promise<void>
  onClose: () => void
}

function parentDir(path: string): string {
  return dirName(path) ?? ''
}

export default function RecentItemsDialog({
  recentFiles,
  recentFolders,
  initialSection,
  onOpenRecentFile,
  onOpenRecentFolder,
  onClose,
}: Props): JSX.Element {
  const [section, setSection] = useState<RecentItemsSection>(initialSection)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose)

  useEffect(() => setSection(initialSection), [initialSection])

  const foldersActive = section === 'folders'
  const items = foldersActive ? recentFolders : recentFiles

  return (
    <div className="modal-backdrop recent-items-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="modal recent-items-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-items-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header recent-items-header">
          <div>
            <h2 id="recent-items-title">{t('最近打开')}</h2>
            <p>{foldersActive ? t('最近打开的文件夹') : t('最近打开的文件')}</p>
          </div>
          <button className="icon-btn sm" onClick={onClose} title={t('关闭')}>
            <X size={15} />
          </button>
        </header>

        <div className="recent-items-tabs" role="tablist" aria-label={t('最近打开')}>
          <button
            type="button"
            role="tab"
            aria-selected={foldersActive}
            className={foldersActive ? 'active' : ''}
            onClick={() => setSection('folders')}
          >
            <Folder size={14} />
            {t('最近文件夹')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!foldersActive}
            className={!foldersActive ? 'active' : ''}
            onClick={() => setSection('files')}
          >
            <FileText size={14} />
            {t('最近文件')}
          </button>
        </div>

        <div className="recent-items-list" role="tabpanel">
          {items.length === 0 ? (
            <div className="recent-items-empty">
              {foldersActive ? t('暂无最近打开的文件夹') : t('暂无最近打开的文件')}
            </div>
          ) : (
            items.map((path) => (
              <button
                key={path}
                type="button"
                className="recent-items-row"
                title={path}
                onClick={() => {
                  onClose()
                  if (foldersActive) void onOpenRecentFolder(path)
                  else void onOpenRecentFile(path)
                }}
              >
                {foldersActive ? <Folder size={17} /> : <FileText size={17} />}
                <span className="recent-items-copy">
                  <strong>{baseName(path)}</strong>
                  <span>{parentDir(path)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
