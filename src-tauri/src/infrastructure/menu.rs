use crate::{domain::error::AppError, infrastructure::lifecycle::LifecycleState};
use std::collections::BTreeMap;
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Manager,
};

fn tr<'a>(language: &str, zh: &'a str, en: &'a str) -> &'a str {
    if language == "en" {
        en
    } else {
        zh
    }
}

fn action(
    app: &AppHandle,
    id: &str,
    label: &str,
    accelerator: Option<String>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, label, true, accelerator.as_deref())
}

fn accelerator(
    shortcuts: &BTreeMap<String, String>,
    id: &str,
    default_binding: &str,
) -> Option<String> {
    let binding = shortcuts
        .get(id)
        .map(String::as_str)
        .unwrap_or(default_binding);
    if binding.is_empty() {
        return None;
    }
    Some(
        binding
            .split('+')
            .map(|part| match part {
                "Mod" => "CmdOrCtrl",
                "Control" => "Ctrl",
                other => other,
            })
            .collect::<Vec<_>>()
            .join("+"),
    )
}

fn app_menu(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let settings = action(
        app,
        "open-settings",
        tr(language, "设置…", "Settings…"),
        accelerator(shortcuts, "open-settings", "Mod+,"),
    )?;
    let updates = MenuItem::with_id(
        app,
        "check-updates",
        tr(language, "检查更新…", "Check for Updates…"),
        true,
        None::<&str>,
    )?;
    let quit = action(
        app,
        "quit",
        tr(language, "退出 Xiangzi MD", "Quit Xiangzi MD"),
        Some("CmdOrCtrl+Q".into()),
    )?;

    SubmenuBuilder::new(app, "Xiangzi MD")
        .about_with_text(
            tr(language, "关于 Xiangzi MD", "About Xiangzi MD"),
            Some(AboutMetadata::default()),
        )
        .separator()
        .item(&settings)
        .item(&updates)
        .separator()
        .hide_with_text(tr(language, "隐藏", "Hide"))
        .hide_others_with_text(tr(language, "隐藏其他", "Hide Others"))
        .show_all_with_text(tr(language, "全部显示", "Show All"))
        .separator()
        .item(&quit)
        .build()
}

fn file_menu(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let new_file = action(
        app,
        "new-file",
        tr(language, "新建文件", "New File"),
        accelerator(shortcuts, "new-file", "Mod+N"),
    )?;
    let open_file = action(
        app,
        "open-file",
        tr(language, "打开文件…", "Open File…"),
        accelerator(shortcuts, "open-file", "Mod+O"),
    )?;
    let open_folder = action(
        app,
        "open-folder",
        tr(language, "打开文件夹…", "Open Folder…"),
        accelerator(shortcuts, "open-folder", "Mod+Shift+O"),
    )?;
    let save = action(
        app,
        "save",
        tr(language, "保存", "Save"),
        accelerator(shortcuts, "save", "Mod+S"),
    )?;
    let save_as = action(
        app,
        "save-as",
        tr(language, "另存为…", "Save As…"),
        accelerator(shortcuts, "save-as", "Mod+Shift+S"),
    )?;
    let export_html = action(app, "export-html", "HTML…", None)?;
    let export_pdf = action(app, "export-pdf", "PDF…", None)?;
    let export_image = action(app, "export-image", tr(language, "图片…", "Image…"), None)?;
    let export = SubmenuBuilder::new(app, tr(language, "导出", "Export"))
        .item(&export_html)
        .item(&export_pdf)
        .item(&export_image)
        .build()?;
    let close_tab = action(
        app,
        "close-tab",
        tr(language, "关闭标签页", "Close Tab"),
        accelerator(shortcuts, "close-tab", "Mod+W"),
    )?;

    SubmenuBuilder::new(app, tr(language, "文件", "File"))
        .item(&new_file)
        .separator()
        .item(&open_file)
        .item(&open_folder)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&export)
        .separator()
        .item(&close_tab)
        .build()
}

fn edit_menu(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let find = action(
        app,
        "find",
        tr(language, "查找", "Find"),
        accelerator(shortcuts, "find", "Mod+F"),
    )?;
    let search = action(
        app,
        "search-in-folder",
        tr(language, "在文件夹中搜索", "Search in Folder"),
        accelerator(shortcuts, "search-in-folder", "Mod+Shift+F"),
    )?;
    let select_all = action(
        app,
        "select-all",
        tr(language, "全选", "Select All"),
        accelerator(shortcuts, "select-all", "Mod+A"),
    )?;

    SubmenuBuilder::new(app, tr(language, "编辑", "Edit"))
        .undo_with_text(tr(language, "撤销", "Undo"))
        .redo_with_text(tr(language, "重做", "Redo"))
        .separator()
        .cut_with_text(tr(language, "剪切", "Cut"))
        .copy_with_text(tr(language, "复制", "Copy"))
        .paste_with_text(tr(language, "粘贴", "Paste"))
        .item(&select_all)
        .separator()
        .item(&find)
        .item(&search)
        .build()
}

fn view_menu(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let entries = [
        (
            "toggle-sidebar",
            "切换侧边栏",
            "Toggle Sidebar",
            "CmdOrCtrl+\\",
        ),
        ("toggle-outline", "大纲", "Outline", "CmdOrCtrl+Shift+K"),
        (
            "toggle-source",
            "切换源码模式",
            "Toggle Source Mode",
            "CmdOrCtrl+/",
        ),
        ("toggle-focus", "专注模式", "Focus Mode", "CmdOrCtrl+Alt+F"),
        (
            "toggle-typewriter",
            "打字机模式",
            "Typewriter Mode",
            "CmdOrCtrl+Shift+T",
        ),
        (
            "command-palette",
            "命令面板",
            "Command Palette",
            "CmdOrCtrl+K",
        ),
        ("show-shortcuts", "快捷键", "Shortcuts", "CmdOrCtrl+Shift+/"),
    ];
    let items = entries
        .into_iter()
        .map(|(id, zh, en, default_binding)| {
            action(
                app,
                id,
                tr(language, zh, en),
                accelerator(shortcuts, id, &default_binding.replace("CmdOrCtrl", "Mod")),
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let zoom_reset = action(
        app,
        "zoom-reset",
        tr(language, "实际大小", "Actual Size"),
        Some("CmdOrCtrl+Shift+0".into()),
    )?;
    let zoom_in = action(
        app,
        "zoom-in",
        tr(language, "放大", "Zoom In"),
        Some("CmdOrCtrl++".into()),
    )?;
    let zoom_out = action(
        app,
        "zoom-out",
        tr(language, "缩小", "Zoom Out"),
        Some("CmdOrCtrl+-".into()),
    )?;
    SubmenuBuilder::new(app, tr(language, "视图", "View"))
        .item(&items[0])
        .item(&items[1])
        .item(&items[2])
        .separator()
        .item(&items[3])
        .item(&items[4])
        .separator()
        .item(&items[5])
        .item(&items[6])
        .separator()
        .item(&zoom_reset)
        .item(&zoom_in)
        .item(&zoom_out)
        .separator()
        .fullscreen_with_text(tr(language, "切换全屏", "Toggle Full Screen"))
        .build()
}

fn window_menu(app: &AppHandle, language: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    SubmenuBuilder::new(app, tr(language, "窗口", "Window"))
        .minimize_with_text(tr(language, "最小化", "Minimize"))
        .maximize_with_text(tr(language, "缩放", "Zoom"))
        .build()
}

pub fn install(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> Result<(), AppError> {
    let install = || -> tauri::Result<()> {
        let application = app_menu(app, language, shortcuts)?;
        let file = file_menu(app, language, shortcuts)?;
        let edit = edit_menu(app, language, shortcuts)?;
        let view = view_menu(app, language, shortcuts)?;
        let window = window_menu(app, language)?;
        let menu = Menu::with_items(app, &[&application, &file, &edit, &view, &window])?;
        app.set_menu(menu)?;
        Ok(())
    };

    install().map_err(|error| AppError::new("menu_install_failed", error.to_string()))
}

pub fn handle_event(app: &AppHandle, id: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    match id {
        "quit" => {
            let _ = window.emit("menu-action", "query-dirty");
        }
        "zoom-reset" | "zoom-in" | "zoom-out" => {
            let delta = match id {
                "zoom-in" => 0.1,
                "zoom-out" => -0.1,
                _ => 0.0,
            };
            let zoom = app.state::<LifecycleState>().update_zoom(delta);
            let _ = window.set_zoom(zoom);
        }
        action => {
            let _ = window.emit("menu-action", action);
        }
    }
}
