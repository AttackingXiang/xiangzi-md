export type Lang = 'zh' | 'en'

/** 中文 -> 英文 词典；以中文原文为键。zh 直接返回原文，en 查表（缺失则回退中文） */
const EN: Record<string, string> = {
  // Sidebar
  资源管理器: 'Explorer',
  收藏目录: 'Favorites',
  尚未打开文件夹: 'No folder opened',
  打开文件夹: 'Open Folder',
  收藏此目录: 'Add to favorites',
  取消收藏: 'Remove from favorites',
  刷新: 'Refresh',
  在文件夹中搜索: 'Search in folder',
  设置: 'Settings',
  // TabBar
  切换侧边栏: 'Toggle sidebar',
  在文件夹中定位: 'Reveal in sidebar',
  大纲: 'Outline',
  '源码 / 所见即所得': 'Source / WYSIWYG',
  // Welcome
  '所见即所得的 Markdown 编辑器': 'A WYSIWYG Markdown editor',
  新建文件: 'New File',
  打开文件: 'Open File',
  最近文件: 'Recent Files',
  最近文件夹: 'Recent Folders',
  // StatusBar
  就绪: 'Ready',
  未保存: 'Unsaved',
  字: 'words',
  字符: 'chars',
  源码: 'Source',
  所见即所得: 'WYSIWYG',
  自动保存: 'Auto-save',
  '● 未保存': '● Unsaved',
  // Settings
  外观: 'Appearance',
  语言: 'Language',
  界面语言: 'Language',
  中文: '中文',
  English: 'English',
  主题: 'Theme',
  跟随系统: 'System',
  浅色: 'Light',
  深色: 'Dark',
  编辑区宽度: 'Editor width',
  适中: 'Normal',
  较宽: 'Wide',
  全宽: 'Full',
  标题自动编号: 'Auto heading numbers',
  '开启后，已保存过的文档在停止输入约 1 秒后自动写回磁盘。':
    'When on, saved documents are written to disk ~1s after you stop typing.',
  '自定义主题 CSS': 'Custom theme CSS',
  清除: 'Clear',
  '更换…': 'Change…',
  '选择…': 'Choose…',
  图片与附件: 'Images & Attachments',
  附件存放方式: 'Attachment location',
  文档同级子文件夹: 'Subfolder next to document',
  '文档同级·按文档名分文件夹': 'Per-document subfolder',
  与文档相同目录: 'Same folder as document',
  仓库根目录: 'Vault root folder',
  仓库根的子文件夹: 'Subfolder in vault root',
  子文件夹名称: 'Subfolder name',
  图片最大显示宽度: 'Max image width',
  'px（0 = 不限制）': 'px (0 = no limit)',
  '修改后对新打开的文档生效。': 'Takes effect for newly opened documents.',
  文件树中隐藏附件文件夹: 'Hide attachment folder in tree',
  '勾选后，文件树不显示与「子文件夹名称」同名的目录（不影响文件实际存储）。':
    'When on, directories matching the attachment subfolder name are hidden from the file tree (files are not affected).',
  额外图片搜索目录: 'Extra image search dirs',
  '图片无法在文档目录找到时，依次搜索这里列出的目录（每行一个绝对路径）。适用于图片统一存放在与文档不同层级的情况。':
    'When an image cannot be found relative to the document, these directories are searched in order (one absolute path per line). Useful when images are stored at a different level than the document.',
  键盘: 'Keyboard',
  快捷键: 'Shortcuts',
  查看全部快捷键: 'View all shortcuts',
  // Outline
  关闭大纲: 'Close outline',
  暂无标题: 'No headings',
  '（空标题）': '(empty heading)',
  // Search
  返回文件: 'Back to files',
  搜索: 'Search',
  '在文件夹中搜索…': 'Search in folder…',
  '搜索中…': 'Searching…',
  个文件: ' files',
  处匹配: ' matches',
  第: 'Line ',
  行: '',
  // Command palette
  '输入命令或文件名…': 'Type a command or file name…',
  无匹配项: 'No matches',
  '查找 / 替换': 'Find / Replace',
  切换大纲: 'Toggle outline',
  切换源码模式: 'Toggle source mode',
  专注模式: 'Focus mode',
  打字机模式: 'Typewriter mode',
  '导出 PDF': 'Export PDF',
  导出图片: 'Export Image',
  '另存为…': 'Save As…',
  另存为: 'Save As',
  查找: 'Find',
  保存: 'Save',
  '打开文件…': 'Open File…',
  '打开文件夹…': 'Open Folder…',
  // Find bar
  替换: 'Replace',
  '查找…': 'Find…',
  '替换为…': 'Replace with…',
  源码模式暂不支持替换: 'Replace not supported in source mode',
  全部替换: 'Replace All',
  上一个: 'Previous',
  下一个: 'Next',
  关闭: 'Close',
  // Editor context menu
  剪切: 'Cut',
  复制: 'Copy',
  粘贴: 'Paste',
  加粗: 'Bold',
  斜体: 'Italic',
  行内代码: 'Inline code',
  '标题 1': 'Heading 1',
  '标题 2': 'Heading 2',
  '标题 3': 'Heading 3',
  正文: 'Paragraph',
  无序列表: 'Bullet list',
  有序列表: 'Numbered list',
  引用: 'Quote',
  代码块: 'Code block',
  全选: 'Select all',
  // File tree context menu
  新建文件夹: 'New Folder',
  打开: 'Open',
  重命名: 'Rename',
  在访达中显示: 'Reveal in Finder',
  删除: 'Delete',
  // Input dialog
  创建: 'Create',
  确定: 'OK',
  取消: 'Cancel',
  // Alerts / misc
  '请先保存文档，再插入本地图片。': 'Please save the document before inserting a local image.',
  请先保存文档后再插入图片: 'Please save the document before inserting an image.',
  重命名失败: 'Rename failed',
  删除失败: 'Delete failed',
  '创建失败：文件可能已存在': 'Create failed: the file may already exist',
  '创建失败：文件夹可能已存在': 'Create failed: the folder may already exist',
  图表语法有误: 'Diagram syntax error',
  // Shortcuts panel groups
  文件: 'File',
  视图: 'View',
  标题与段落: 'Headings & Paragraph',
  文本格式: 'Text Format',
  块与列表: 'Blocks & Lists',
  关闭标签页: 'Close tab',
  关闭其他: 'Close others',
  关闭左侧全部: 'Close to the left',
  关闭右侧全部: 'Close to the right',
  关闭全部: 'Close all',
  '一级 ~ 六级标题': 'Heading 1 – 6',
  '标题（备用键位）': 'Headings (alt keys)',
  设为正文: 'Set paragraph',
  软换行: 'Soft line break',
  列表缩进: 'Indent list',
  列表反缩进: 'Outdent list',
  命令面板: 'Command palette',
  // Slash menu
  文本: 'Text',
  标题1: 'Heading 1',
  标题2: 'Heading 2',
  标题3: 'Heading 3',
  标题4: 'Heading 4',
  标题5: 'Heading 5',
  标题6: 'Heading 6',
  分割线: 'Divider',
  列表: 'List',
  任务列表: 'Task List',
  高级: 'Advanced',
  图片: 'Image',
  表格: 'Table',
  公式: 'Math',
}

let lang: Lang = 'zh'

export function setLang(l: Lang): void {
  lang = l
}

export function getLang(): Lang {
  return lang
}

/** 翻译：zh 返回原文，en 查表 */
export function t(zh: string): string {
  if (lang === 'zh') return zh
  return EN[zh] ?? zh
}
