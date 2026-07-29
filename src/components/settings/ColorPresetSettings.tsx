import { Check, Pencil, Pipette, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { AppSettings } from '../../types'
import { MAX_COLOR_PRESETS, normalizeHexColor } from '../../lib/colorPresets'

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  en: boolean
}

export default function ColorPresetSettings({ settings, onChange, en }: Props): JSX.Element {
  const [textDraft, setTextDraft] = useState(settings.defaultTextColor)
  const [highlightDraft, setHighlightDraft] = useState(settings.defaultHighlightColor)
  const [openEditors, setOpenEditors] = useState<Record<'text' | 'highlight', boolean>>({
    text: false,
    highlight: false,
  })

  const editor = (
    kind: 'text' | 'highlight',
    colors: string[],
    selected: string,
    draft: string,
    setDraft: (value: string) => void,
  ): JSX.Element => {
    const listKey = kind === 'text' ? 'textColorPresets' : 'highlightColorPresets'
    const defaultKey = kind === 'text' ? 'defaultTextColor' : 'defaultHighlightColor'
    const title =
      kind === 'text' ? (en ? 'Text colors' : '文字颜色') : en ? 'Highlighter colors' : '荧光笔颜色'
    const open = openEditors[kind]
    const save = (next: string[], nextDefault: string): void =>
      onChange({ [listKey]: next, [defaultKey]: nextDefault })
    const normalizedDraft = normalizeHexColor(draft)
    const add = (): void => {
      const color = normalizedDraft
      if (!color) return
      if (!colors.includes(color) && colors.length >= MAX_COLOR_PRESETS) return
      const next = colors.includes(color) ? colors : [...colors, color].slice(0, MAX_COLOR_PRESETS)
      save(next, color)
      setDraft(color)
    }
    return (
      <div className="color-preset-editor">
        <div className="color-preset-current-panel">
          <div className="color-preset-current-summary">
            <span
              className="color-preset-chip color-preset-current-chip"
              style={{ backgroundColor: selected }}
            />
            <span className="color-preset-current-copy">
              <strong>{title}</strong>
              <small>
                {selected} · {colors.length}
                {en ? ' presets' : ' 个预设'}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="secondary-btn color-preset-edit"
            aria-expanded={open}
            onClick={() => setOpenEditors((current) => ({ ...current, [kind]: !current[kind] }))}
          >
            {open ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <Pencil size={13} aria-hidden="true" />
            )}
            {open ? (en ? 'Done' : '完成') : en ? 'Edit…' : '修改…'}
          </button>
        </div>
        {open && (
          <div className="color-preset-panel">
            <div className="color-preset-title">
              {title}
              <small>
                {en ? 'Choose a preset to use by default.' : '选择一个预设作为默认色。'}
              </small>
            </div>
            <div className="color-preset-list">
              {colors.map((color) => (
                <div
                  key={color}
                  className={`color-preset-item${color === selected ? ' is-default' : ''}`}
                >
                  <button
                    className="color-preset-swatch"
                    title={color}
                    aria-label={`${color}${color === selected ? (en ? ' default' : ' 默认') : ''}`}
                    onClick={() => save(colors, color)}
                  >
                    <span className="color-preset-chip" style={{ backgroundColor: color }} />
                    <span className="color-preset-value">{color}</span>
                    {color === selected && (
                      <Check size={13} className="color-preset-check" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    className="color-preset-remove"
                    aria-label={`${en ? 'Remove' : '删除'} ${color}`}
                    disabled={colors.length <= 1}
                    onClick={() => {
                      const next = colors.filter((item) => item !== color)
                      save(next, color === selected ? (next[0] ?? selected) : selected)
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="color-preset-add">
              <label className="color-preset-picker" title={en ? 'Choose color' : '选择颜色'}>
                <span
                  className="color-preset-picker-chip"
                  style={{ backgroundColor: normalizedDraft ?? 'transparent' }}
                />
                <Pipette size={14} aria-hidden="true" />
                <input
                  type="color"
                  value={normalizedDraft ?? '#000000'}
                  aria-label={en ? 'Choose color' : '选择颜色'}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <input
                className="color-preset-value-input"
                value={draft}
                aria-label={en ? 'Color value' : '颜色值'}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') add()
                }}
              />
              <button
                onClick={add}
                disabled={
                  normalizedDraft === null ||
                  (!colors.includes(normalizedDraft) && colors.length >= MAX_COLOR_PRESETS)
                }
              >
                <Plus size={13} />
                {en ? 'Add' : '添加'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="color-preset-settings">
      {editor(
        'text',
        settings.textColorPresets,
        settings.defaultTextColor,
        textDraft,
        setTextDraft,
      )}
      {editor(
        'highlight',
        settings.highlightColorPresets,
        settings.defaultHighlightColor,
        highlightDraft,
        setHighlightDraft,
      )}
    </div>
  )
}
