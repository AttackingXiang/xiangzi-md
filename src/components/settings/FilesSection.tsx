import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { desktop } from '../../platform'
import type { AppSettings } from '../../types'
import { TEXT_FORMAT_GROUPS, isGroupEnabled, toggleGroup } from '../../lib/textFormats'
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
        {settings.fileTreeSort === 'smart' && (
          <p className="settings-hint">
            {en
              ? 'Smart blends how often and how recently you open a file with its last edit, floating your active and frequently-used files up. Currently open tabs rank first; folders follow the liveliest file inside them.'
              : '「智能推荐」综合打开频率、最近打开与最近修改，把你常用、刚碰过的文件顶上来：当前打开的标签页优先，文件夹跟随其内部最活跃的文件。'}
          </p>
        )}
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
      <SettingsCard title={en ? 'Tag tree' : '标签树'}>
        <SettingRow
          label={en ? 'Tag tree sort' : '标签树排序'}
          description={
            en
              ? 'How tags are ordered within each level of the all-tags tree.'
              : '决定「全部标签」树里每一层标签的排列顺序。'
          }
        >
          <select
            value={settings.tagTreeSort ?? 'count'}
            onChange={(event) =>
              onChange({
                tagTreeSort: event.target.value as AppSettings['tagTreeSort'],
              })
            }
          >
            <option value="count">{en ? 'Document count' : '文档数'}</option>
            <option value="name">{en ? 'Name (A→Z)' : '名称（A→Z）'}</option>
            <option value="nameDesc">{en ? 'Name (Z→A)' : '名称（Z→A）'}</option>
            <option value="smart">{en ? 'Smart (recommended)' : '智能推荐'}</option>
          </select>
        </SettingRow>
        {(settings.tagTreeSort ?? 'count') === 'smart' && (
          <p className="settings-hint">
            {en
              ? 'Smart ranks each tag by the recent activity of the documents inside it — recently opened or edited — so the tags you are working in rise to the top. The active document’s tags rank first.'
              : '「智能推荐」按标签下文档的近期活跃度（最近打开 / 最近修改）排序，让你正在用的标签冒到前面；当前文档所属的标签优先。'}
          </p>
        )}
        <ToggleRow
          label={en ? 'Groups first' : '分组优先置顶'}
          description={
            en
              ? 'Show tags that contain sub-tags before plain tags at each level.'
              : '每一层里，把含子标签的分组排在普通标签前面。'
          }
          checked={settings.tagGroupsFirst ?? true}
          onChange={(checked) => onChange({ tagGroupsFirst: checked })}
        />
        <SettingRow label={en ? 'Results order' : '结果列排序'}>
          <select
            value={settings.tagResultSort ?? 'updated'}
            onChange={(event) =>
              onChange({
                tagResultSort: event.target.value as AppSettings['tagResultSort'],
              })
            }
          >
            <option value="updated">{en ? 'Last modified' : '最近修改'}</option>
            <option value="name">{en ? 'Name' : '名称'}</option>
          </select>
        </SettingRow>
        <SettingRow label={en ? 'Default expand level' : '默认展开层级'}>
          <select
            value={String(settings.tagDefaultExpandDepth ?? -1)}
            onChange={(event) => onChange({ tagDefaultExpandDepth: Number(event.target.value) })}
          >
            <option value="-1">{en ? 'Expand all' : '全部展开'}</option>
            <option value="0">{en ? 'Top level only' : '仅顶层'}</option>
            <option value="1">{en ? 'Two levels' : '展开两层'}</option>
            <option value="2">{en ? 'Three levels' : '展开三层'}</option>
          </select>
        </SettingRow>
        <p className="settings-hint">
          {en
            ? 'The expand/collapse state of the tag tree is remembered. Changing the default level resets it.'
            : '标签树的展开/折叠状态会被记住；改动默认层级会重置为该层级。'}
        </p>
      </SettingsCard>
      <SettingsCard title={en ? 'Always-visible formats' : '始终显示的格式'}>
        <p className="settings-hint">
          {en
            ? 'Checked formats always appear in the file tree, even when “Show all files” is off. Markdown and extensionless files are always shown.'
            : '勾选的格式始终显示在文件树中，即使关闭「显示全部文件」也生效。Markdown 与无扩展名文件始终显示。'}
        </p>
        <div className="format-whitelist">
          <label className="format-whitelist-item is-locked">
            <input type="checkbox" checked disabled />
            <span>Markdown</span>
          </label>
          {TEXT_FORMAT_GROUPS.map((group) => (
            <label key={group.id} className="format-whitelist-item">
              <input
                type="checkbox"
                checked={isGroupEnabled(group, settings.visibleTextExtensions)}
                onChange={(event) =>
                  onChange({
                    visibleTextExtensions: toggleGroup(
                      group,
                      settings.visibleTextExtensions,
                      event.target.checked,
                    ),
                  })
                }
              />
              <span>{en ? group.labelEn : group.label}</span>
            </label>
          ))}
        </div>
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
