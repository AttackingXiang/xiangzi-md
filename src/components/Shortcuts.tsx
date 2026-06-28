import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  SHORTCUT_DEFINITIONS,
  displayShortcut,
  effectiveShortcut,
  isSafeShortcut,
  shortcutFromKeyboardEvent,
  type ShortcutAction,
  type ShortcutCategory,
} from '../lib/shortcuts'
import { getLang } from '../lib/i18n'

interface Props {
  overrides: Record<string, string>
  onChange: (next: Record<string, string>) => void
}

const categoryOrder: ShortcutCategory[] = ['file', 'navigation', 'format']

export default function Shortcuts({ overrides, onChange }: Props): JSX.Element {
  const en = getLang() === 'en'
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(
    () =>
      categoryOrder.map((category) => ({
        category,
        items: SHORTCUT_DEFINITIONS.filter((definition) => definition.category === category),
      })),
    [],
  )

  const setBinding = (action: ShortcutAction, binding: string): void => {
    const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === action)
    if (!definition) return
    const conflict = SHORTCUT_DEFINITIONS.find(
      (item) => item.id !== action && effectiveShortcut(overrides, item.id) === binding,
    )
    if (conflict) {
      setError(en ? `Already used by “${conflict.labelEn}”.` : `已被“${conflict.labelZh}”使用。`)
      return
    }
    const next = { ...overrides }
    if (binding === definition.defaultBinding) delete next[action]
    else next[action] = binding
    onChange(next)
    setRecording(null)
    setError(null)
  }

  const resetBinding = (action: ShortcutAction): void => {
    if (!(action in overrides)) return
    const next = { ...overrides }
    delete next[action]
    onChange(next)
    setError(null)
  }

  return (
    <div className="shortcut-settings">
      <div className="settings-section-intro">
        <div>
          <h2>{en ? 'Keyboard shortcuts' : '自定义快捷键'}</h2>
          <p>
            {en
              ? 'Click a shortcut, then press a new key combination. Conflicts are rejected automatically.'
              : '点击快捷键后直接按下新组合键；冲突会被自动拦截。'}
          </p>
        </div>
        <button
          className="secondary-btn"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => onChange({})}
        >
          <RotateCcw size={14} />
          {en ? 'Reset all' : '全部恢复默认'}
        </button>
      </div>

      {error && (
        <div className="settings-inline-error" role="alert">
          {error}
        </div>
      )}

      {grouped.map(({ category, items }) => (
        <section className="shortcut-group" key={category}>
          <h3>
            {category === 'file'
              ? en
                ? 'File'
                : '文件'
              : category === 'navigation'
                ? en
                  ? 'Navigation and view'
                  : '导航与视图'
                : en
                  ? 'Editor formatting'
                  : '编辑与格式'}
          </h3>
          <div className="shortcut-list">
            {items.map((definition) => {
              const binding = effectiveShortcut(overrides, definition.id)
              const customized = definition.id in overrides
              return (
                <div className="shortcut-row" key={definition.id}>
                  <span className="shortcut-label">
                    {en ? definition.labelEn : definition.labelZh}
                    {customized && <small>{en ? 'Custom' : '已自定义'}</small>}
                  </span>
                  <button
                    type="button"
                    className={`shortcut-recorder${recording === definition.id ? ' recording' : ''}`}
                    data-shortcut-recorder
                    aria-label={`${en ? definition.labelEn : definition.labelZh}: ${binding}`}
                    onClick={() => {
                      setRecording(definition.id)
                      setError(null)
                    }}
                    onBlur={() =>
                      setRecording((current) => (current === definition.id ? null : current))
                    }
                    onKeyDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        setRecording(null)
                        return
                      }
                      if (event.key === 'Backspace' || event.key === 'Delete') {
                        resetBinding(definition.id)
                        setRecording(null)
                        return
                      }
                      const next = shortcutFromKeyboardEvent(event)
                      if (!next || !isSafeShortcut(next)) {
                        setError(
                          en
                            ? 'Use Command/Ctrl, Control, or Alt with another key.'
                            : '请使用 Command/Ctrl、Control 或 Alt 与其他按键组合。',
                        )
                        return
                      }
                      setBinding(definition.id, next)
                    }}
                  >
                    {recording === definition.id ? (
                      <span className="shortcut-recording-label">
                        {en ? 'Press keys…' : '请按组合键…'}
                      </span>
                    ) : (
                      displayShortcut(binding).map((key) => <kbd key={key}>{key}</kbd>)
                    )}
                  </button>
                  <button
                    className="icon-btn sm"
                    disabled={!customized}
                    title={en ? 'Reset' : '恢复默认'}
                    aria-label={en ? 'Reset shortcut' : '恢复默认快捷键'}
                    onClick={() => resetBinding(definition.id)}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
