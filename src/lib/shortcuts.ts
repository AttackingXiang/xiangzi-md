export type ShortcutCategory = 'file' | 'navigation' | 'format'

export type ShortcutAction =
  | 'new-file'
  | 'open-file'
  | 'open-folder'
  | 'save'
  | 'save-as'
  | 'close-tab'
  | 'find'
  | 'search-in-folder'
  | 'select-all'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'toggle-source'
  | 'toggle-focus'
  | 'toggle-typewriter'
  | 'toggle-selection-toolbar'
  | 'open-settings'
  | 'show-shortcuts'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'paragraph'
  | 'promote-heading'
  | 'demote-heading'
  | 'bold'
  | 'italic'
  | 'inline-code'
  | 'quote'
  | 'code-block'
  | 'bullet-list'
  | 'ordered-list'

export interface ShortcutDefinition {
  id: ShortcutAction
  category: ShortcutCategory
  labelZh: string
  labelEn: string
  defaultBinding: string
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    id: 'new-file',
    category: 'file',
    labelZh: '新建文件',
    labelEn: 'New File',
    defaultBinding: 'Mod+N',
  },
  {
    id: 'open-file',
    category: 'file',
    labelZh: '打开文件',
    labelEn: 'Open File',
    defaultBinding: 'Mod+O',
  },
  {
    id: 'open-folder',
    category: 'file',
    labelZh: '打开文件夹',
    labelEn: 'Open Folder',
    defaultBinding: 'Mod+Shift+O',
  },
  { id: 'save', category: 'file', labelZh: '保存', labelEn: 'Save', defaultBinding: 'Mod+S' },
  {
    id: 'save-as',
    category: 'file',
    labelZh: '另存为',
    labelEn: 'Save As',
    defaultBinding: 'Mod+Shift+S',
  },
  {
    id: 'close-tab',
    category: 'file',
    labelZh: '关闭标签页',
    labelEn: 'Close Tab',
    defaultBinding: 'Mod+W',
  },
  { id: 'find', category: 'navigation', labelZh: '查找', labelEn: 'Find', defaultBinding: 'Mod+F' },
  {
    id: 'search-in-folder',
    category: 'navigation',
    labelZh: '在文件夹中搜索',
    labelEn: 'Search in Folder',
    defaultBinding: 'Mod+Shift+F',
  },
  {
    id: 'select-all',
    category: 'navigation',
    labelZh: '全选文章',
    labelEn: 'Select All Document',
    defaultBinding: 'Mod+A',
  },
  {
    id: 'command-palette',
    category: 'navigation',
    labelZh: '命令面板',
    labelEn: 'Command Palette',
    defaultBinding: 'Mod+K',
  },
  {
    id: 'toggle-sidebar',
    category: 'navigation',
    labelZh: '切换侧边栏',
    labelEn: 'Toggle Sidebar',
    defaultBinding: 'Mod+\\',
  },
  {
    id: 'toggle-outline',
    category: 'navigation',
    labelZh: '切换大纲',
    labelEn: 'Toggle Outline',
    defaultBinding: 'Mod+Shift+K',
  },
  {
    id: 'toggle-source',
    category: 'navigation',
    labelZh: '源码 / 所见即所得',
    labelEn: 'Source / WYSIWYG',
    defaultBinding: 'Mod+/',
  },
  {
    id: 'toggle-focus',
    category: 'navigation',
    labelZh: '专注模式',
    labelEn: 'Focus Mode',
    defaultBinding: 'Mod+Alt+F',
  },
  {
    id: 'toggle-typewriter',
    category: 'navigation',
    labelZh: '打字机模式',
    labelEn: 'Typewriter Mode',
    defaultBinding: 'Mod+Shift+T',
  },
  {
    id: 'toggle-selection-toolbar',
    category: 'navigation',
    labelZh: '切换选中文本快捷工具栏',
    labelEn: 'Toggle Selection Toolbar',
    defaultBinding: 'Mod+Alt+T',
  },
  {
    id: 'open-settings',
    category: 'navigation',
    labelZh: '设置',
    labelEn: 'Settings',
    defaultBinding: 'Mod+,',
  },
  {
    id: 'show-shortcuts',
    category: 'navigation',
    labelZh: '快捷键设置',
    labelEn: 'Keyboard Shortcuts',
    defaultBinding: 'Mod+Shift+/',
  },
  {
    id: 'heading-1',
    category: 'format',
    labelZh: '一级标题',
    labelEn: 'Heading 1',
    defaultBinding: 'Mod+1',
  },
  {
    id: 'heading-2',
    category: 'format',
    labelZh: '二级标题',
    labelEn: 'Heading 2',
    defaultBinding: 'Mod+2',
  },
  {
    id: 'heading-3',
    category: 'format',
    labelZh: '三级标题',
    labelEn: 'Heading 3',
    defaultBinding: 'Mod+3',
  },
  {
    id: 'heading-4',
    category: 'format',
    labelZh: '四级标题',
    labelEn: 'Heading 4',
    defaultBinding: 'Mod+4',
  },
  {
    id: 'heading-5',
    category: 'format',
    labelZh: '五级标题',
    labelEn: 'Heading 5',
    defaultBinding: 'Mod+5',
  },
  {
    id: 'heading-6',
    category: 'format',
    labelZh: '六级标题',
    labelEn: 'Heading 6',
    defaultBinding: 'Mod+6',
  },
  {
    id: 'paragraph',
    category: 'format',
    labelZh: '设为正文',
    labelEn: 'Paragraph',
    defaultBinding: 'Mod+0',
  },
  {
    id: 'promote-heading',
    category: 'format',
    labelZh: '升级标题',
    labelEn: 'Promote Heading',
    defaultBinding: 'Mod+Alt+ArrowUp',
  },
  {
    id: 'demote-heading',
    category: 'format',
    labelZh: '降级标题',
    labelEn: 'Demote Heading',
    defaultBinding: 'Mod+Alt+ArrowDown',
  },
  { id: 'bold', category: 'format', labelZh: '加粗', labelEn: 'Bold', defaultBinding: 'Mod+B' },
  { id: 'italic', category: 'format', labelZh: '斜体', labelEn: 'Italic', defaultBinding: 'Mod+I' },
  {
    id: 'inline-code',
    category: 'format',
    labelZh: '行内代码',
    labelEn: 'Inline Code',
    defaultBinding: 'Mod+E',
  },
  {
    id: 'quote',
    category: 'format',
    labelZh: '引用',
    labelEn: 'Quote',
    defaultBinding: 'Mod+Shift+B',
  },
  {
    id: 'code-block',
    category: 'format',
    labelZh: '代码块',
    labelEn: 'Code Block',
    defaultBinding: 'Mod+Alt+C',
  },
  {
    id: 'bullet-list',
    category: 'format',
    labelZh: '无序列表',
    labelEn: 'Bullet List',
    defaultBinding: 'Mod+Alt+8',
  },
  {
    id: 'ordered-list',
    category: 'format',
    labelZh: '有序列表',
    labelEn: 'Ordered List',
    defaultBinding: 'Mod+Alt+7',
  },
] as const

const definitionById = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
)

export function isShortcutAction(value: string): value is ShortcutAction {
  return definitionById.has(value as ShortcutAction)
}

export function effectiveShortcut(
  overrides: Record<string, string>,
  action: ShortcutAction,
): string {
  return overrides[action] || definitionById.get(action)?.defaultBinding || ''
}

export function effectiveShortcutMap(
  overrides: Record<string, string>,
): Map<string, ShortcutAction> {
  const result = new Map<string, ShortcutAction>()
  for (const definition of SHORTCUT_DEFINITIONS) {
    const binding = effectiveShortcut(overrides, definition.id)
    if (binding) result.set(binding, definition.id)
  }
  return result
}

function normalizedKey(key: string): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  const aliases: Record<string, string> = {
    Esc: 'Escape',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
  }
  return aliases[key] || key
}

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent | React.KeyboardEvent,
): string | null {
  const key = normalizedKey(event.key)
  if (!key) return null
  const parts: string[] = []
  const isMac = /mac/i.test(navigator.platform)
  if ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) parts.push('Mod')
  if ((isMac && event.ctrlKey) || (!isMac && event.metaKey)) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function isSafeShortcut(binding: string): boolean {
  if (!binding || binding.length > 64) return false
  const parts = binding.split('+')
  if (parts.length < 2 || parts.some((part) => !part)) return false
  const key = parts.at(-1) ?? ''
  const modifiers = new Set(parts.slice(0, -1))
  if ([...modifiers].some((part) => !['Mod', 'Control', 'Alt', 'Shift'].includes(part)))
    return false
  if (!modifiers.has('Mod') && !modifiers.has('Control') && !modifiers.has('Alt')) return false
  return /^[A-Z0-9]$|^[,./;='\[\]\\-]$|^(Space|Enter|Escape|Tab|Backspace|Delete|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2]))$/.test(
    key,
  )
}

export function displayShortcut(binding: string): string[] {
  const isMac = /mac/i.test(navigator.platform)
  const display: Record<string, string> = isMac
    ? {
        Mod: '⌘',
        Control: '⌃',
        Alt: '⌥',
        Shift: '⇧',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      }
    : {
        Mod: 'Ctrl',
        Control: 'Win',
        Alt: 'Alt',
        Shift: 'Shift',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      }
  return binding.split('+').map((part) => display[part] || part)
}
