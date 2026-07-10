use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) const SETTINGS_SCHEMA_VERSION: u32 = 8;
pub(crate) const MAX_RECENT_ITEMS: usize = 15;
pub(crate) const MAX_FAVORITES: usize = 32;
pub(crate) const MAX_PINNED_FOLDERS: usize = 64;
pub(crate) const MAX_TAG_COLLAPSED_KEYS: usize = 4096;
pub(crate) const MAX_SESSION_FILES: usize = 12;
pub(crate) const MAX_ASSET_SEARCH_PATHS: usize = 32;
pub(crate) const MAX_HIDDEN_WORKSPACE_PATHS: usize = 64;
pub(crate) const MAX_SHORTCUT_OVERRIDES: usize = 64;
pub(crate) const MAX_PATH_LENGTH: usize = 4096;
pub(crate) const MAX_FAVORITE_LABEL_CHARS: usize = 80;
pub(crate) const MAX_PANDOC_ARGS_LENGTH: usize = 8_192;

pub(crate) const SHORTCUT_ACTIONS: &[&str] = &[
    "new-file",
    "open-file",
    "open-folder",
    "save",
    "save-as",
    "close-tab",
    "find",
    "search-in-folder",
    "select-all",
    "command-palette",
    "toggle-sidebar",
    "toggle-outline",
    "toggle-source",
    "toggle-focus",
    "toggle-typewriter",
    "toggle-selection-toolbar",
    "open-settings",
    "show-shortcuts",
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-4",
    "heading-5",
    "heading-6",
    "paragraph",
    "promote-heading",
    "demote-heading",
    "bold",
    "italic",
    "inline-code",
    "quote",
    "code-block",
    "bullet-list",
    "ordered-list",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    pub folder: Option<String>,
    pub open_files: Vec<String>,
    pub active_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub attachment_mode: String,
    pub attachment_folder: String,
    pub image_max_width: u32,
    pub language: String,
    pub theme: String,
    pub editor_width: String,
    pub custom_css_path: String,
    /// 背景图片的绝对路径；空字符串表示不启用。
    pub background_image_path: String,
    /// 背景图片可见强度，0-100。
    pub background_opacity: u32,
    /// 代码块表面的不透明度，0-100。
    pub code_block_opacity: u32,
    /// 当前主题背景色的深浅偏移，-50（更深）到 50（更浅），0 表示不调整。
    pub theme_shade: i32,
    pub heading_number: bool,
    pub auto_save: bool,
    pub check_updates_on_startup: bool,
    pub shortcuts: BTreeMap<String, String>,
    pub recent_files: Vec<String>,
    pub recent_folders: Vec<String>,
    pub favorites: Vec<String>,
    pub favorite_files: Vec<String>,
    pub favorites_collapsed: bool,
    pub favorite_labels: BTreeMap<String, String>,
    /// 在「全部标签」面板里置顶的标签 key（规范化小写）。
    pub pinned_tags: Vec<String>,
    /// 「全部标签」树里被折叠的分组 key（含置顶区的 `pin:` 前缀）；空表示全部展开。
    pub tag_collapsed_keys: Vec<String>,
    /// 标签树默认展开层级：-1 全部展开（默认），0 仅顶层，N 展开到第 N 层。
    pub tag_default_expand_depth: i32,
    /// 是否把「含子标签的分组」排在同级前面（默认按文档数排序）。
    pub tag_groups_first: bool,
    /// 中间结果列的排序方式：'updated'（修改时间，默认）或 'name'（名称）。
    pub tag_result_sort: String,
    /// 点正文里的标签时是否同时展开左侧「全部标签」树（默认关：只出结果列）。
    pub tag_click_opens_overview: bool,
    pub session: SessionSettings,
    /// 文件树排序方式：'default'（文件夹在前、名称升序，默认）、'nameDesc'、
    /// 'modified'（最近修改）、'opened'（最近打开）、'smart'（智能混合推荐）。
    pub file_tree_sort: String,
    /// 在文件树中被置顶的文件夹绝对路径，同级里排在未置顶项之前。
    pub pinned_folders: Vec<String>,
    pub hide_attachment_folders: bool,
    pub asset_search_paths: Vec<String>,
    pub show_all_files: bool,
    /// 用户勾选「始终显示」的文本/代码扩展名（小写、不含点）。即便关闭 show_all_files，
    /// 命中的扩展名也会出现在文件树里。Markdown 与无扩展名文件不受此列表限制。
    pub visible_text_extensions: Vec<String>,
    pub hidden_workspace_paths: Vec<String>,
    /// Name patterns hidden when show_all_files is true (matches file or folder names exactly).
    pub hidden_name_patterns: Vec<String>,
    pub allow_remote_images: bool,
    pub show_toolbar: bool,
    pub show_selection_toolbar: bool,
    /// 表格列宽策略：distribute（智能占满）、fit（内容适配）、equal（等宽）或 none。
    pub table_auto_width: String,
    pub table_auto_resize: bool,
    pub show_status_bar: bool,
    pub show_status_path: bool,
    pub show_reading_mode_control: bool,
    pub show_source_mode_control: bool,
    pub show_reveal_button: bool,
    /// 侧边栏顶部的"打开文件夹"按钮；默认隐藏（仍可用 Welcome 页/快捷键打开）
    pub show_open_folder_button: bool,
    /// 侧边栏顶部的"设置"按钮；默认隐藏（仍可用 ⌘, / 命令面板打开）
    pub show_settings_button: bool,
    /// 复制含图片的内容时：'image' 复制图片本身（默认），'address' 复制地址
    pub image_copy_mode: String,
    /// 复制 Mermaid 图表时：'image' 复制图片（默认），'source' 复制源码文本
    pub mermaid_copy_mode: String,
    /// pandoc 可执行文件的自定义路径，空字符串表示自动探测
    pub pandoc_path: String,
    /// 自定义 reference.docx；空字符串表示使用 Pandoc 内置模板
    pub pandoc_reference_doc: String,
    /// 导入/导出的附加参数（按命令行引号规则解析，但不经过 shell）
    pub pandoc_export_args: String,
    pub pandoc_import_args: String,
    /// 导入 Word 时提取图片的相对目录
    pub pandoc_media_folder: String,
    pub pandoc_toc: bool,
    pub pandoc_number_sections: bool,
    /// 是否执行项目既有的宋体/黑体及黑色标题规范化
    pub pandoc_normalize_fonts: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            attachment_mode: "subfolder".into(),
            attachment_folder: "assets".into(),
            image_max_width: 800,
            language: "zh".into(),
            theme: "system".into(),
            editor_width: "full".into(),
            custom_css_path: String::new(),
            background_image_path: String::new(),
            background_opacity: 30,
            code_block_opacity: 30,
            theme_shade: 0,
            heading_number: false,
            auto_save: false,
            check_updates_on_startup: true,
            shortcuts: BTreeMap::new(),
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
            favorites: Vec::new(),
            favorite_files: Vec::new(),
            favorites_collapsed: false,
            favorite_labels: BTreeMap::new(),
            pinned_tags: Vec::new(),
            tag_collapsed_keys: Vec::new(),
            tag_default_expand_depth: -1,
            tag_groups_first: false,
            tag_result_sort: "updated".into(),
            tag_click_opens_overview: false,
            session: SessionSettings::default(),
            file_tree_sort: "default".into(),
            pinned_folders: Vec::new(),
            hide_attachment_folders: false,
            asset_search_paths: Vec::new(),
            show_all_files: false,
            // 默认勾选全部受支持格式，保持「支持即可见」的既有体验；用户可逐项取消。
            visible_text_extensions: [
                "txt",
                "log",
                "json",
                "json5",
                "jsonc",
                "yaml",
                "yml",
                "toml",
                "ini",
                "conf",
                "properties",
                "xml",
                "svg",
                "html",
                "htm",
                "css",
                "js",
                "mjs",
                "cjs",
                "jsx",
                "ts",
                "mts",
                "cts",
                "tsx",
                "sql",
                "sh",
                "bash",
                "zsh",
            ]
            .iter()
            .map(|ext| (*ext).to_string())
            .collect(),
            hidden_workspace_paths: Vec::new(),
            hidden_name_patterns: vec![
                ".git".into(),
                "node_modules".into(),
                ".obsidian".into(),
                ".vscode".into(),
                "dist".into(),
                "build".into(),
                ".DS_Store".into(),
            ],
            allow_remote_images: false,
            show_toolbar: false,
            show_selection_toolbar: false,
            table_auto_width: "distribute".into(),
            table_auto_resize: true,
            show_status_bar: true,
            show_status_path: true,
            show_reading_mode_control: true,
            show_source_mode_control: true,
            show_reveal_button: true,
            show_open_folder_button: false,
            show_settings_button: false,
            image_copy_mode: "image".into(),
            mermaid_copy_mode: "image".into(),
            pandoc_path: String::new(),
            pandoc_reference_doc: String::new(),
            pandoc_export_args: String::new(),
            pandoc_import_args: String::new(),
            pandoc_media_folder: "assets".into(),
            pandoc_toc: false,
            pandoc_number_sections: false,
            pandoc_normalize_fonts: true,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub attachment_mode: Option<String>,
    pub attachment_folder: Option<String>,
    pub image_max_width: Option<u32>,
    pub language: Option<String>,
    pub theme: Option<String>,
    pub editor_width: Option<String>,
    pub custom_css_path: Option<String>,
    pub background_image_path: Option<String>,
    pub background_opacity: Option<u32>,
    pub code_block_opacity: Option<u32>,
    pub theme_shade: Option<i32>,
    pub heading_number: Option<bool>,
    pub auto_save: Option<bool>,
    pub check_updates_on_startup: Option<bool>,
    pub shortcuts: Option<BTreeMap<String, String>>,
    pub recent_files: Option<Vec<String>>,
    pub recent_folders: Option<Vec<String>>,
    pub favorites: Option<Vec<String>>,
    pub favorite_files: Option<Vec<String>>,
    pub favorites_collapsed: Option<bool>,
    pub favorite_labels: Option<BTreeMap<String, String>>,
    pub pinned_tags: Option<Vec<String>>,
    pub tag_collapsed_keys: Option<Vec<String>>,
    pub tag_default_expand_depth: Option<i32>,
    pub tag_groups_first: Option<bool>,
    pub tag_result_sort: Option<String>,
    pub tag_click_opens_overview: Option<bool>,
    pub session: Option<SessionSettings>,
    pub file_tree_sort: Option<String>,
    pub pinned_folders: Option<Vec<String>>,
    pub hide_attachment_folders: Option<bool>,
    pub asset_search_paths: Option<Vec<String>>,
    pub show_all_files: Option<bool>,
    pub visible_text_extensions: Option<Vec<String>>,
    pub hidden_workspace_paths: Option<Vec<String>>,
    pub hidden_name_patterns: Option<Vec<String>>,
    pub allow_remote_images: Option<bool>,
    pub show_toolbar: Option<bool>,
    pub show_selection_toolbar: Option<bool>,
    pub table_auto_width: Option<String>,
    pub table_auto_resize: Option<bool>,
    pub show_status_bar: Option<bool>,
    pub show_status_path: Option<bool>,
    pub show_reading_mode_control: Option<bool>,
    pub show_source_mode_control: Option<bool>,
    pub show_reveal_button: Option<bool>,
    pub show_open_folder_button: Option<bool>,
    pub show_settings_button: Option<bool>,
    pub image_copy_mode: Option<String>,
    pub mermaid_copy_mode: Option<String>,
    pub pandoc_path: Option<String>,
    pub pandoc_reference_doc: Option<String>,
    pub pandoc_export_args: Option<String>,
    pub pandoc_import_args: Option<String>,
    pub pandoc_media_folder: Option<String>,
    pub pandoc_toc: Option<bool>,
    pub pandoc_number_sections: Option<bool>,
    pub pandoc_normalize_fonts: Option<bool>,
}

impl SettingsPatch {
    pub fn affects_menu(&self) -> bool {
        self.language.is_some() || self.shortcuts.is_some()
    }
}
