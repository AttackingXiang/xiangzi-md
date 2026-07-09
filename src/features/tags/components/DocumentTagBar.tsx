import { Plus, Tag } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { normalizeTag, tagKey } from '../frontmatter'
import TagChip from './TagChip'
import { t } from '../../../lib/i18n'

export interface DocumentTagChip {
  tag: string
  /** frontmatter 里的标签可以删；只存在于正文内联 #标签 的不能删（正文内容
   * 本身没法从这个标签栏改，删除得回正文里手动改字）。 */
  removable: boolean
}

interface Props {
  tags: DocumentTagChip[]
  activeTag: string | null
  disabled?: boolean
  onSelectTag: (tag: string) => void
  onAddTag: (tag: string) => Promise<boolean>
  onRemoveTag: (tag: string) => Promise<boolean>
}

export default function DocumentTagBar({
  tags,
  activeTag,
  disabled = false,
  onSelectTag,
  onAddTag,
  onRemoveTag,
}: Props): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const cancel = (): void => {
    if (saving) return
    setAdding(false)
    setValue('')
  }

  const submit = async (): Promise<void> => {
    const tag = normalizeTag(value)
    if (!tag || saving) return
    setSaving(true)
    // saving 必须无论如何都复位——否则 onAddTag 一旦异常/拒绝，Enter 和失焦
    // 取消(两者都靠 `if (saving) return` 守卫)就会永久失效，标签框卡死打不开也关不掉。
    let saved = false
    try {
      saved = await onAddTag(tag)
    } finally {
      setSaving(false)
    }
    if (saved) {
      setAdding(false)
      setValue('')
    }
  }

  const remove = async (tag: string): Promise<void> => {
    const key = tagKey(tag)
    if (removingKey) return
    setRemovingKey(key)
    try {
      await onRemoveTag(tag)
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <div className="document-tag-bar" aria-label="文档标签">
      <span className="document-tag-label">
        <Tag size={13} />
        {t('标签')}
      </span>
      <div className="document-tag-list">
        {tags.length === 0 && <span className="document-tag-empty">{t('暂无标签')}</span>}
        {tags.map(({ tag, removable }) => (
          <TagChip
            key={tagKey(tag)}
            tag={tag}
            active={activeTag === tagKey(tag)}
            removing={removingKey === tagKey(tag)}
            onClick={() => onSelectTag(tag)}
            onRemove={removable ? () => void remove(tag) : undefined}
          />
        ))}
        {adding ? (
          <span className="tag-add-editor">
            <span aria-hidden="true">#</span>
            <input
              ref={inputRef}
              value={value}
              maxLength={48}
              placeholder={t('标签名称')}
              disabled={saving}
              onChange={(event) => setValue(event.target.value.replace(/[\r\n,\[\]]/g, ''))}
              onBlur={() => {
                // 点到别处失焦：有内容就提交（跟 Notion/Obsidian 一致），空则取消。
                if (value.trim()) void submit()
                else cancel()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancel()
                }
              }}
            />
          </span>
        ) : (
          <button
            type="button"
            className="tag-add-button"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            <Plus size={13} />
            {t('添加标签')}
          </button>
        )}
      </div>
    </div>
  )
}
