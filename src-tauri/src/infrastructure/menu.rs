use crate::{domain::error::AppError, infrastructure::lifecycle::LifecycleState};
use serde::Deserialize;
use std::collections::BTreeMap;
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Manager,
};

/// 菜单结构与快捷键默认值都读自仓库根的 shared/*.json —— 与
/// src/components/TitleBarMenu.tsx 同一份数据。以前两侧各写一份，已经漂移出
/// 可见差异（导出在这边是子菜单、那边是平铺，标签文案不同，「复制为纯文本」
/// 只有那边有，缩放加速键只有这边显示）。
///
/// include_str! 在编译期读入，cargo 会跟踪这两个文件，改了会自动重新编译。
const MENU_JSON: &str = include_str!("../../../shared/menu.json");
const SHORTCUTS_JSON: &str = include_str!("../../../shared/shortcuts.json");

#[derive(Deserialize)]
struct MenuModel {
    menus: Vec<ModelSubmenu>,
}

#[derive(Deserialize)]
struct ModelSubmenu {
    id: String,
    label: Label,
    items: Vec<ModelItem>,
}

#[derive(Deserialize, Clone)]
struct Label {
    zh: String,
    en: String,
}

impl Label {
    fn get(&self, language: &str) -> &str {
        if language == "en" {
            &self.en
        } else {
            &self.zh
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ModelItem {
    Separator {
        #[serde(default)]
        platforms: Option<Vec<String>>,
    },
    Action {
        id: String,
        label: Label,
        #[serde(default)]
        shortcut: Option<String>,
        #[serde(default)]
        accelerator: Option<String>,
        #[serde(default)]
        platforms: Option<Vec<String>>,
    },
    Submenu {
        label: Label,
        items: Vec<ModelItem>,
        #[serde(default)]
        platforms: Option<Vec<String>>,
    },
    Native {
        role: String,
        label: Label,
        #[serde(default)]
        platforms: Option<Vec<String>>,
    },
}

impl ModelItem {
    fn platforms(&self) -> Option<&Vec<String>> {
        match self {
            ModelItem::Separator { platforms }
            | ModelItem::Action { platforms, .. }
            | ModelItem::Submenu { platforms, .. }
            | ModelItem::Native { platforms, .. } => platforms.as_ref(),
        }
    }

    fn applies_here(&self) -> bool {
        match self.platforms() {
            None => true,
            Some(list) => list.iter().any(|name| name == current_platform()),
        }
    }
}

#[derive(Deserialize)]
struct ShortcutModel {
    shortcuts: Vec<ShortcutDefinition>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutDefinition {
    id: String,
    default_binding: String,
    #[serde(default)]
    mac_default_binding: Option<String>,
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn model() -> Result<MenuModel, AppError> {
    serde_json::from_str(MENU_JSON)
        .map_err(|error| AppError::new("menu_model_invalid", error.to_string()))
}

fn shortcut_defaults() -> Result<BTreeMap<String, String>, AppError> {
    let parsed: ShortcutModel = serde_json::from_str(SHORTCUTS_JSON)
        .map_err(|error| AppError::new("shortcut_model_invalid", error.to_string()))?;
    Ok(parsed
        .shortcuts
        .into_iter()
        .map(|definition| {
            let binding = if cfg!(target_os = "macos") {
                definition
                    .mac_default_binding
                    .unwrap_or(definition.default_binding)
            } else {
                definition.default_binding
            };
            (definition.id, binding)
        })
        .collect())
}

/// 把内部的 `Mod+Shift+X` 记法转成 Tauri 的加速键语法。
fn to_accelerator(binding: &str) -> Option<String> {
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

/// 用户自定义优先，其次是 shared/shortcuts.json 里的默认值。
fn accelerator_for(
    item_shortcut: Option<&str>,
    item_accelerator: Option<&str>,
    user_shortcuts: &BTreeMap<String, String>,
    defaults: &BTreeMap<String, String>,
) -> Option<String> {
    if let Some(id) = item_shortcut {
        let binding = user_shortcuts
            .get(id)
            .or_else(|| defaults.get(id))
            .map(String::as_str)
            .unwrap_or("");
        return to_accelerator(binding);
    }
    item_accelerator.and_then(to_accelerator)
}

fn build_submenu(
    app: &AppHandle,
    title: &str,
    items: &[ModelItem],
    language: &str,
    user_shortcuts: &BTreeMap<String, String>,
    defaults: &BTreeMap<String, String>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::new(app, title);
    // 平台过滤会留下开头/结尾/连续的分隔线，这里边构建边收拾。
    let mut separator_pending = false;
    let mut has_content = false;

    for item in items.iter().filter(|item| item.applies_here()) {
        if matches!(item, ModelItem::Separator { .. }) {
            separator_pending = has_content;
            continue;
        }
        if separator_pending {
            builder = builder.separator();
            separator_pending = false;
        }
        has_content = true;

        builder = match item {
            ModelItem::Separator { .. } => unreachable!("separators are handled above"),
            ModelItem::Action {
                id,
                label,
                shortcut,
                accelerator,
                ..
            } => {
                let accel = accelerator_for(
                    shortcut.as_deref(),
                    accelerator.as_deref(),
                    user_shortcuts,
                    defaults,
                );
                let entry =
                    MenuItem::with_id(app, id, label.get(language), true, accel.as_deref())?;
                builder.item(&entry)
            }
            ModelItem::Submenu { label, items, .. } => {
                let nested = build_submenu(
                    app,
                    label.get(language),
                    items,
                    language,
                    user_shortcuts,
                    defaults,
                )?;
                builder.item(&nested)
            }
            ModelItem::Native { role, label, .. } => {
                let text = label.get(language);
                match role.as_str() {
                    "about" => builder.about_with_text(text, Some(AboutMetadata::default())),
                    "hide" => builder.hide_with_text(text),
                    "hideOthers" => builder.hide_others_with_text(text),
                    "showAll" => builder.show_all_with_text(text),
                    "undo" => builder.undo_with_text(text),
                    "redo" => builder.redo_with_text(text),
                    "cut" => builder.cut_with_text(text),
                    "copy" => builder.copy_with_text(text),
                    "paste" => builder.paste_with_text(text),
                    "fullscreen" => builder.fullscreen_with_text(text),
                    _ => builder,
                }
            }
        };
    }

    builder.build()
}

pub fn install(
    app: &AppHandle,
    language: &str,
    shortcuts: &BTreeMap<String, String>,
) -> Result<(), AppError> {
    let model = model()?;
    let defaults = shortcut_defaults()?;

    let build = || -> tauri::Result<()> {
        let submenus = model
            .menus
            .iter()
            .map(|submenu| {
                // 顶层菜单标题：应用菜单在 macOS 上由系统替换成应用名，
                // 其余按语言取。
                let title = if submenu.id == "app" {
                    "Xiangzi MD"
                } else {
                    submenu.label.get(language)
                };
                build_submenu(app, title, &submenu.items, language, shortcuts, &defaults)
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        // No "Window" submenu: the app is single-window, so minimize/zoom there
        // duplicated the traffic-light controls without adding anything.
        let refs = submenus.iter().collect::<Vec<_>>();
        let menu = Menu::with_items(
            app,
            &refs
                .iter()
                .map(|submenu| *submenu as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
                .collect::<Vec<_>>(),
        )?;
        app.set_menu(menu)?;
        Ok(())
    };

    build().map_err(|error| AppError::new("menu_install_failed", error.to_string()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_menu_model_parses() {
        let model = model().expect("shared/menu.json 应能解析");
        let ids: Vec<&str> = model.menus.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["app", "file", "edit", "view", "tools", "recent"]);
    }

    #[test]
    fn every_referenced_shortcut_exists() {
        // 模型里写错一个 shortcut id，菜单会静默地不显示加速键。
        let model = model().expect("菜单模型应能解析");
        let defaults = shortcut_defaults().expect("快捷键表应能解析");

        fn walk<'a>(items: &'a [ModelItem], out: &mut Vec<&'a str>) {
            for item in items {
                match item {
                    ModelItem::Action {
                        shortcut: Some(id), ..
                    } => out.push(id),
                    ModelItem::Submenu { items, .. } => walk(items, out),
                    _ => {}
                }
            }
        }
        let mut referenced = Vec::new();
        for submenu in &model.menus {
            walk(&submenu.items, &mut referenced);
        }
        assert!(!referenced.is_empty());
        for id in referenced {
            assert!(
                defaults.contains_key(id),
                "shared/menu.json 引用了未定义的快捷键 {id}"
            );
        }
    }

    #[test]
    fn bindings_translate_to_tauri_accelerators() {
        assert_eq!(
            to_accelerator("Mod+Shift+S").as_deref(),
            Some("CmdOrCtrl+Shift+S")
        );
        assert_eq!(
            to_accelerator("Control+Shift+`").as_deref(),
            Some("Ctrl+Shift+`")
        );
        assert_eq!(to_accelerator(""), None);
    }

    #[test]
    fn user_shortcuts_win_over_defaults() {
        let defaults = shortcut_defaults().expect("快捷键表应能解析");
        let mut user = BTreeMap::new();
        user.insert("save".to_owned(), "Mod+Alt+S".to_owned());

        assert_eq!(
            accelerator_for(Some("save"), None, &user, &defaults).as_deref(),
            Some("CmdOrCtrl+Alt+S")
        );
        assert_eq!(
            accelerator_for(Some("save"), None, &BTreeMap::new(), &defaults).as_deref(),
            Some("CmdOrCtrl+S")
        );
    }
}
