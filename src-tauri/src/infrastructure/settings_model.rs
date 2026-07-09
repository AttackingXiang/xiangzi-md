use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) const SETTINGS_SCHEMA_VERSION: u32 = 7;
pub(crate) const MAX_RECENT_ITEMS: usize = 15;
pub(crate) const MAX_FAVORITES: usize = 32;
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
    pub favorites_collapsed: bool,
    pub favorite_labels: BTreeMap<String, String>,
    /// 在「全部标签」面板里置顶的标签 key（规范化小写）。
    pub pinned_tags: Vec<String>,
    pub session: SessionSettings,
    pub hide_attachment_folders: bool,
    pub asset_search_paths: Vec<String>,
    pub show_all_files: bool,
    pub hidden_workspace_paths: Vec<String>,
    /// Name patterns hidden when show_all_files is true (matches file or folder names exactly).
    pub hidden_name_patterns: Vec<String>,
    pub allow_remote_images: bool,
    pub show_toolbar: bool,
    pub show_selection_toolbar: bool,
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
            favorites_collapsed: false,
            favorite_labels: BTreeMap::new(),
            pinned_tags: Vec::new(),
            session: SessionSettings::default(),
            hide_attachment_folders: false,
            asset_search_paths: Vec::new(),
            show_all_files: false,
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
    pub favorites_collapsed: Option<bool>,
    pub favorite_labels: Option<BTreeMap<String, String>>,
    pub pinned_tags: Option<Vec<String>>,
    pub session: Option<SessionSettings>,
    pub hide_attachment_folders: Option<bool>,
    pub asset_search_paths: Option<Vec<String>>,
    pub show_all_files: Option<bool>,
    pub hidden_workspace_paths: Option<Vec<String>>,
    pub hidden_name_patterns: Option<Vec<String>>,
    pub allow_remote_images: Option<bool>,
    pub show_toolbar: Option<bool>,
    pub show_selection_toolbar: Option<bool>,
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
