import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Command as CommandIcon } from 'lucide-react'
import { t } from '../lib/i18n'

export interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface FileEntry {
  path: string
  name: string
}

interface Props {
  commands: Command[]
  files: FileEntry[]
  onOpenFile: (path: string, name: string) => void
  onClose: () => void
}

interface Item {
  key: string
  label: string
  hint?: string
  icon: 'cmd' | 'file'
  run: () => void
}

/** 简单的子串模糊匹配 */
function matches(text: string, q: string): boolean {
  if (!q) return true
  return text.toLowerCase().includes(q.toLowerCase())
}

export default function CommandPalette({
  commands,
  files,
  onOpenFile,
  onClose,
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo<Item[]>(() => {
    const cmdItems: Item[] = commands
      .filter((c) => matches(c.label, query))
      .map((c) => ({ key: 'c:' + c.id, label: c.label, hint: c.hint, icon: 'cmd', run: c.run }))
    const fileItems: Item[] = files
      .filter((f) => matches(f.name, query))
      .slice(0, 50)
      .map((f) => ({
        key: 'f:' + f.path,
        label: f.name,
        hint: f.path,
        icon: 'file',
        run: () => onOpenFile(f.path, f.name),
      }))
    return [...cmdItems, ...fileItems]
  }, [commands, files, query, onOpenFile])

  useEffect(() => {
    setActive(0)
  }, [query])

  // Scroll active item into view when navigating with keyboard
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const activeEl = list.children[active] as HTMLElement | undefined
    activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const exec = (item: Item | undefined): void => {
    if (!item) return
    item.run()
    onClose()
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={t('输入命令或文件名…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              exec(items[active])
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">{t('无匹配项')}</div>}
          {items.map((it, i) => (
            <div
              key={it.key}
              className={`palette-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => exec(it)}
            >
              {it.icon === 'cmd' ? <CommandIcon size={14} /> : <FileText size={14} />}
              <span className="palette-label">{it.label}</span>
              {it.hint && <span className="palette-hint">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
