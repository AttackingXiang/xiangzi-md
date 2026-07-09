import {
  Calendar,
  CalendarClock,
  Forward,
  Hash,
  Plus,
  SquareCheck,
  Tag,
  Tags,
  Text,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { createElement, useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import {
  coerceValue,
  PROPERTY_TYPES,
  propertyTypeLabel,
  type DocumentProperty,
  type PropertyType,
} from '../properties'
import { normalizeTag, tagKey } from '../frontmatter'
import TagChip from './TagChip'
import { t } from '../../../lib/i18n'

interface Props {
  properties: DocumentProperty[]
  /** 正文里手打的 #标签（只读展示在 tags 行末尾，不能从这里删——见 DocumentTagBar 注释） */
  inlineTags: string[]
  activeTag: string | null
  disabled?: boolean
  onSelectTag: (tag: string) => void
  /** 用整份新属性列表覆盖 frontmatter，返回是否写入成功。 */
  onChange: (next: DocumentProperty[]) => Promise<boolean>
}

function isTagsKey(key: string): boolean {
  return /^tags?$/i.test(key.trim())
}

/** 「添加属性」时的候选项：常见 frontmatter 键 + 默认类型；已存在的键会被过滤掉，
 * tags（标签）排第一（仿 Obsidian）。写入的是规范英文键，展示名走 i18n。 */
const SUGGESTED_PROPERTIES: { key: string; type: PropertyType }[] = [
  { key: 'tags', type: 'list' },
  { key: 'aliases', type: 'list' },
  { key: 'cssclasses', type: 'list' },
  { key: 'date', type: 'date' },
  { key: 'created', type: 'date' },
  { key: 'description', type: 'text' },
  { key: 'author', type: 'text' },
  { key: 'publish', type: 'checkbox' },
]

// 常见键的本地化展示名（i18n 词典以中文为键）；未收录的键直接显示原键名。
const KEY_LABELS: Record<string, string> = {
  tags: '标签',
  aliases: '别名',
  cssclasses: 'CSS 类',
  date: '日期',
  created: '创建日期',
  description: '描述',
  author: '作者',
  publish: '发布',
}

function suggestionLabel(key: string): string {
  const label = KEY_LABELS[key]
  return label ? t(label) : key
}

function emptyValueForType(type: PropertyType): DocumentProperty['value'] {
  if (type === 'list') return []
  if (type === 'checkbox') return false
  return null
}

function typeIcon(prop: DocumentProperty): LucideIcon {
  const key = prop.key.trim().toLowerCase()
  if (isTagsKey(prop.key)) return Tag
  if (key === 'aliases' || key === 'alias') return Forward
  switch (prop.type) {
    case 'list':
      return Tags
    case 'number':
      return Hash
    case 'checkbox':
      return SquareCheck
    case 'date':
      return Calendar
    case 'datetime':
      return CalendarClock
    default:
      return Text
  }
}

/** 单行属性的值编辑器（列表类型由 ListValueEditor 单独处理）。用本地草稿 +
 * 失焦提交，避免每敲一个字都触发一次整篇写盘；外部值变化时在未聚焦的情况下
 * 重新同步。 */
const ScalarValueEditor: FC<{
  prop: DocumentProperty
  disabled: boolean
  onCommit: (value: DocumentProperty['value']) => void
}> = ({ prop, disabled, onCommit }) => {
  const asText = (): string => {
    if (prop.value === null || prop.value === undefined) return ''
    if (prop.type === 'datetime') return String(prop.value).replace(' ', 'T').slice(0, 16)
    return String(prop.value)
  }
  const [draft, setDraft] = useState(asText)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(asText())
  }, [prop.value, prop.type])

  if (prop.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        className="prop-value-checkbox"
        checked={Boolean(prop.value)}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.checked)}
      />
    )
  }

  const commit = (): void => {
    const trimmed = draft.trim()
    if (prop.type === 'number') {
      const parsed = Number(trimmed)
      onCommit(trimmed === '' || !Number.isFinite(parsed) ? null : parsed)
      return
    }
    onCommit(trimmed === '' ? null : draft)
  }

  const inputType =
    prop.type === 'number'
      ? 'number'
      : prop.type === 'date'
        ? 'date'
        : prop.type === 'datetime'
          ? 'datetime-local'
          : 'text'

  return (
    <input
      type={inputType}
      className="prop-value-input"
      value={draft}
      placeholder={t('空')}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(asText())
          focused.current = false
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** 列表类型（tags / aliases / 任意多值属性）的值编辑器：一排可删的 chip +
 * 行内新增输入框。tags 行的 chip 复用 TagChip（带 # 前缀、点击可跳转标签导航），
 * 其余列表用中性 chip。 */
const ListValueEditor: FC<{
  items: string[]
  inlineTags: string[]
  asTags: boolean
  activeTag: string | null
  disabled: boolean
  onSelectTag: (tag: string) => void
  onChange: (next: string[]) => void
}> = ({ items, inlineTags, asTags, activeTag, disabled, onSelectTag, onChange }) => {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const submit = (): void => {
    const next = normalizeTag(value)
    if (next && !items.some((item) => tagKey(item) === tagKey(next))) {
      onChange([...items, next])
    }
    setValue('')
    setAdding(false)
  }

  const removeAt = (index: number): void => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="prop-list">
      {items.map((item, index) =>
        asTags ? (
          <TagChip
            key={`${item}-${index}`}
            tag={item}
            active={activeTag === tagKey(item)}
            onClick={() => onSelectTag(item)}
            onRemove={disabled ? undefined : () => removeAt(index)}
          />
        ) : (
          <span key={`${item}-${index}`} className="prop-chip">
            <span className="prop-chip-label">{item}</span>
            {!disabled && (
              <button
                type="button"
                className="prop-chip-remove"
                aria-label={t('删除')}
                onClick={() => removeAt(index)}
              >
                <Plus size={11} style={{ transform: 'rotate(45deg)' }} />
              </button>
            )}
          </span>
        ),
      )}
      {asTags &&
        inlineTags.map((tag) => (
          <TagChip
            key={`inline-${tag}`}
            tag={tag}
            active={activeTag === tagKey(tag)}
            onClick={() => onSelectTag(tag)}
          />
        ))}
      {adding ? (
        <span className="prop-list-add-editor">
          {asTags && <span aria-hidden="true">#</span>}
          <input
            ref={inputRef}
            value={value}
            maxLength={120}
            placeholder={asTags ? t('标签名称') : t('值')}
            onChange={(event) => setValue(event.target.value.replace(/[\r\n,[\]]/g, ''))}
            onBlur={() => {
              if (value.trim()) submit()
              else {
                setValue('')
                setAdding(false)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setValue('')
                setAdding(false)
              }
            }}
          />
        </span>
      ) : (
        !disabled && (
          <button
            type="button"
            className="prop-list-add"
            aria-label={t('添加')}
            onClick={() => setAdding(true)}
          >
            <Plus size={13} />
          </button>
        )
      )}
    </div>
  )
}

const PropertyRow: FC<{
  prop: DocumentProperty
  index: number
  siblingKeys: string[]
  inlineTags: string[]
  activeTag: string | null
  disabled: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onSelectTag: (tag: string) => void
  onPatch: (patch: Partial<DocumentProperty>) => void
  onRemove: () => void
}> = ({
  prop,
  siblingKeys,
  inlineTags,
  activeTag,
  disabled,
  menuOpen,
  onToggleMenu,
  onSelectTag,
  onPatch,
  onRemove,
}) => {
  const [keyDraft, setKeyDraft] = useState(prop.key)
  const keyFocused = useRef(false)
  useEffect(() => {
    if (!keyFocused.current) setKeyDraft(prop.key)
  }, [prop.key])

  const commitKey = (): void => {
    const next = keyDraft.trim()
    const clash = next && siblingKeys.some((k) => k.toLowerCase() === next.toLowerCase())
    if (!next || clash) {
      setKeyDraft(prop.key) // 空名或与其它属性重名：撤销改动
      return
    }
    if (next !== prop.key) onPatch({ key: next })
  }

  return (
    <div className="prop-row">
      <div className="prop-key">
        <button
          type="button"
          className="prop-type-button"
          aria-label={t('属性类型')}
          title={prop.complex ? t('复杂值，请在源码模式编辑') : t(propertyTypeLabel(prop.type))}
          disabled={disabled || prop.complex}
          onClick={onToggleMenu}
        >
          {createElement(typeIcon(prop), { size: 15 })}
        </button>
        <input
          className="prop-key-input"
          value={keyDraft}
          placeholder={t('属性名称')}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => setKeyDraft(event.target.value.replace(/[\r\n:]/g, ''))}
          onFocus={() => {
            keyFocused.current = true
          }}
          onBlur={() => {
            keyFocused.current = false
            commitKey()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setKeyDraft(prop.key)
              keyFocused.current = false
              event.currentTarget.blur()
            }
          }}
        />
        {menuOpen && (
          <div className="prop-type-menu" role="menu">
            {PROPERTY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={type === prop.type}
                className={`prop-type-option${type === prop.type ? ' active' : ''}`}
                onClick={() => {
                  onToggleMenu()
                  if (type !== prop.type) onPatch({ type, value: coerceValue(prop.value, type) })
                }}
              >
                {t(propertyTypeLabel(type))}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="prop-value">
        {prop.complex ? (
          <span className="prop-value-complex" title={t('复杂值，请在源码模式编辑')}>
            {t('复杂值，请在源码模式编辑')}
          </span>
        ) : prop.type === 'list' ? (
          <ListValueEditor
            items={Array.isArray(prop.value) ? prop.value : []}
            inlineTags={isTagsKey(prop.key) ? inlineTags : []}
            asTags={isTagsKey(prop.key)}
            activeTag={activeTag}
            disabled={disabled}
            onSelectTag={onSelectTag}
            onChange={(next) => onPatch({ value: next })}
          />
        ) : (
          <ScalarValueEditor
            prop={prop}
            disabled={disabled}
            onCommit={(value) => onPatch({ value })}
          />
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          className="prop-row-remove"
          aria-label={t('删除属性')}
          title={t('删除属性')}
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

export default function DocumentPropertyPanel({
  properties,
  inlineTags,
  activeTag,
  disabled = false,
  onSelectTag,
  onChange,
}: Props): JSX.Element {
  const [menuIndex, setMenuIndex] = useState<number | null>(null)
  const [addingKey, setAddingKey] = useState('')
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLInputElement>(null)
  // 点候选项时用 onMouseDown 提前处理，会先触发输入框 blur——用这个标记让 blur
  // 里的“提交输入的键”逻辑让位，避免同时又按输入内容加了一个属性。
  const suppressAddBlur = useRef(false)

  useEffect(() => {
    if (adding) addRef.current?.focus()
  }, [adding])

  // 点击面板外部时收起类型菜单。
  useEffect(() => {
    if (menuIndex === null) return
    const close = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.prop-type-menu, .prop-type-button')
      ) {
        return
      }
      setMenuIndex(null)
    }
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [menuIndex])

  const emit = (next: DocumentProperty[]): void => {
    void onChange(next)
  }
  const patchAt = (index: number, patch: Partial<DocumentProperty>): void => {
    emit(properties.map((prop, i) => (i === index ? { ...prop, ...patch } : prop)))
  }
  const removeAt = (index: number): void => {
    setMenuIndex(null)
    emit(properties.filter((_, i) => i !== index))
  }
  const present = new Set(properties.map((p) => p.key.trim().toLowerCase()))
  const addProperty = (key: string, type: PropertyType): void => {
    if (key && !present.has(key.toLowerCase())) {
      emit([...properties, { key, type, value: emptyValueForType(type) }])
    }
    setAddingKey('')
    setAdding(false)
  }
  const submitNewKey = (): void => {
    const key = addingKey.trim()
    addProperty(key, isTagsKey(key) ? 'list' : 'text')
  }
  // 「添加属性」的候选项：常见键去掉已存在的，再按输入过滤（键名或本地化展示名）。
  const filter = addingKey.trim().toLowerCase()
  const suggestions = SUGGESTED_PROPERTIES.filter(
    (s) =>
      !present.has(s.key) &&
      (!filter || s.key.includes(filter) || suggestionLabel(s.key).toLowerCase().includes(filter)),
  )

  // 阅读模式（disabled）下只做只读展示：没有任何属性时整块不渲染，避免出现一张
  // 空卡片；有属性时照常展示，但不给"添加属性"入口。
  if (disabled && properties.length === 0) return <></>

  return (
    <div className="document-properties" aria-label={t('文档属性')}>
      {properties.length > 0 && (
        <div className="prop-rows">
          {properties.map((prop, index) => (
            <PropertyRow
              key={index}
              prop={prop}
              index={index}
              siblingKeys={properties.filter((_, i) => i !== index).map((p) => p.key)}
              inlineTags={inlineTags}
              activeTag={activeTag}
              disabled={disabled}
              menuOpen={menuIndex === index}
              onToggleMenu={() => setMenuIndex((current) => (current === index ? null : index))}
              onSelectTag={onSelectTag}
              onPatch={(patch) => patchAt(index, patch)}
              onRemove={() => removeAt(index)}
            />
          ))}
        </div>
      )}
      {disabled ? null : adding ? (
        <div className="prop-add-editor">
          <input
            ref={addRef}
            value={addingKey}
            maxLength={64}
            placeholder={t('属性名称')}
            spellCheck={false}
            onChange={(event) => setAddingKey(event.target.value.replace(/[\r\n:]/g, ''))}
            onBlur={() => {
              if (suppressAddBlur.current) {
                suppressAddBlur.current = false
                return
              }
              submitNewKey()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitNewKey()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setAddingKey('')
                setAdding(false)
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className="prop-suggest-menu" role="listbox">
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="prop-suggest-option"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    suppressAddBlur.current = true
                    addProperty(s.key, s.type)
                  }}
                >
                  {createElement(typeIcon({ key: s.key, type: s.type, value: null }), { size: 15 })}
                  <span className="prop-suggest-label">{suggestionLabel(s.key)}</span>
                  <span className="prop-suggest-key">{s.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button type="button" className="prop-add-button" onClick={() => setAdding(true)}>
          <Plus size={13} />
          {t('添加属性')}
        </button>
      )}
    </div>
  )
}
