import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { desktop } from '../../platform'
import type { AppSettings } from '../../types'
import { SettingsPage, SettingsCard, SettingRow, ToggleRow } from './primitives'
import type { SectionProps } from './types'

export default function FilesSection({ settings, onChange, en }: SectionProps): JSX.Element {
  return (
    <SettingsPage
      title={en ? 'Files' : '文件'}
      description={
        en ? 'Control what the workspace tree displays.' : '控制工作区文件树显示哪些内容。'
      }
    >
      <SettingsCard>
        <SettingRow
          label={en ? 'File tree sort' : '文件树排序'}
          description={
            en
              ? 'How items are ordered within each folder. Pinned folders always come first.'
              : '决定每个文件夹内文件的排列顺序；置顶的文件夹始终排在最前。'
          }
        >
          <select
            value={settings.fileTreeSort}
            onChange={(event) =>
              onChange({
                fileTreeSort: event.target.value as AppSettings['fileTreeSort'],
              })
            }
          >
            <option value="default">{en ? 'Name (A→Z)' : '名称（A→Z）'}</option>
            <option value="nameDesc">{en ? 'Name (Z→A)' : '名称（Z→A）'}</option>
            <option value="modified">{en ? 'Recently modified' : '最近修改'}</option>
            <option value="opened">{en ? 'Recently opened' : '最近打开'}</option>
            <option value="smart">{en ? 'Smart (recommended)' : '智能推荐'}</option>
          </select>
        </SettingRow>
        <ToggleRow
          label={en ? 'Show all files' : '显示全部文件'}
          description={
            en
              ? 'Unsupported files are visible but cannot be opened in the editor.'
              : '不支持的文件会显示在文件树中，但不能在编辑器中打开。'
          }
          checked={settings.showAllFiles}
          onChange={(checked) => onChange({ showAllFiles: checked })}
        />
        <ToggleRow
          label={en ? 'Load remote images' : '加载远程图片'}
          description={
            en
              ? 'Disabled by default to avoid leaking your IP address to image hosts.'
              : '默认关闭，避免向图片服务器泄露 IP 地址等访问信息。'
          }
          checked={settings.allowRemoteImages}
          onChange={(checked) => onChange({ allowRemoteImages: checked })}
        />
      </SettingsCard>
      {settings.showAllFiles && (
        <>
          <SettingsCard title={en ? 'Hidden by name' : '按名称隐藏'}>
            <p className="settings-hint">
              {en
                ? 'Any file or folder whose name exactly matches a pattern is hidden everywhere in the workspace tree.'
                : '文件或文件夹名称完全匹配时，在工作区任何位置都会被隐藏。'}
            </p>
            <HiddenNamePatterns
              patterns={settings.hiddenNamePatterns}
              onChange={(hiddenNamePatterns) => onChange({ hiddenNamePatterns })}
              en={en}
            />
          </SettingsCard>
          <SettingsCard title={en ? 'Hidden folders' : '手动隐藏的文件夹'}>
            <p className="settings-hint">
              {en
                ? 'Selected folders and all descendants are omitted from the workspace tree.'
                : '选中的文件夹及其全部子项不会出现在工作区文件树中。'}
            </p>
            <div className="settings-path-list">
              {settings.hiddenWorkspacePaths.length === 0 && (
                <p className="settings-empty-text">
                  {en ? 'No folders are hidden.' : '尚未隐藏任何文件夹。'}
                </p>
              )}
              {settings.hiddenWorkspacePaths.map((path) => (
                <div className="settings-path-row" key={path}>
                  <span title={path}>{path}</span>
                  <button
                    className="icon-btn sm"
                    aria-label={en ? `Show ${path}` : `取消隐藏 ${path}`}
                    onClick={() =>
                      onChange({
                        hiddenWorkspacePaths: settings.hiddenWorkspacePaths.filter(
                          (item) => item !== path,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary-btn"
              disabled={settings.hiddenWorkspacePaths.length >= 64}
              onClick={async () => {
                const result = await desktop.pickFolder()
                if (!result || settings.hiddenWorkspacePaths.includes(result.path)) return
                onChange({
                  hiddenWorkspacePaths: [...settings.hiddenWorkspacePaths, result.path].slice(
                    0,
                    64,
                  ),
                })
              }}
            >
              {en ? 'Choose folder…' : '选择文件夹…'}
            </button>
          </SettingsCard>
        </>
      )}
    </SettingsPage>
  )
}

function HiddenNamePatterns({
  patterns,
  onChange,
  en,
}: {
  patterns: string[]
  onChange: (next: string[]) => void
  en: boolean
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || patterns.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...patterns, trimmed])
    setDraft('')
  }

  return (
    <div className="hidden-name-patterns">
      <div className="name-pattern-tags">
        {patterns.map((p) => (
          <span key={p} className="name-pattern-tag">
            {p}
            <button
              className="name-pattern-remove"
              aria-label={en ? `Remove ${p}` : `移除 ${p}`}
              onClick={() => onChange(patterns.filter((x) => x !== p))}
            >
              ×
            </button>
          </span>
        ))}
        {patterns.length === 0 && (
          <span className="settings-empty-text">{en ? 'No patterns.' : '暂无规则。'}</span>
        )}
      </div>
      <div className="name-pattern-input-row">
        <input
          className="input-dialog-field name-pattern-input"
          placeholder={en ? 'e.g. dist, .next, *.log' : '例如 dist、.next、*.log'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="secondary-btn" onClick={add} disabled={!draft.trim()}>
          {en ? 'Add' : '添加'}
        </button>
      </div>
    </div>
  )
}
