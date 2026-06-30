mod commands;
mod domain;
mod infrastructure;

use infrastructure::settings::SettingsStore;
use infrastructure::{lifecycle::LifecycleState, menu};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            infrastructure::lifecycle::queue_supported_arguments(app, args);
            infrastructure::lifecycle::reveal_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SettingsStore::default())
        .manage(LifecycleState::default())
        .register_uri_scheme_protocol("xmd", infrastructure::protocol::handle_xmd)
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = app.state::<SettingsStore>().get(&handle)?;
            menu::install(&handle, &settings.language, &settings.shortcuts)?;
            infrastructure::lifecycle::queue_supported_arguments(&handle, std::env::args().skip(1));
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let lifecycle = window.state::<LifecycleState>();
                if !lifecycle.is_quit_confirmed() {
                    api.prevent_close();
                    let _ = window.emit("menu-action", "query-dirty");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::app::frontend_ready,
            commands::app::quit_confirmed,
            commands::workspace::open_folder_path,
            commands::workspace::read_file,
            commands::workspace::write_file,
            commands::workspace::read_dir,
            commands::workspace::list_files,
            commands::workspace::create_file,
            commands::workspace::create_dir,
            commands::workspace::rename_item,
            commands::workspace::move_item,
            commands::workspace::trash_item,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::search::search_in_folder,
            commands::attachment::save_attachment,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Xiangzi MD");

    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            let lifecycle = app.state::<LifecycleState>();
            if code.is_none() && !lifecycle.is_quit_confirmed() {
                api.prevent_exit();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("menu-action", "query-dirty");
                }
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    infrastructure::lifecycle::queue_supported_path(app, &path.to_string_lossy());
                }
            }
            infrastructure::lifecycle::reveal_main_window(app);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            infrastructure::lifecycle::reveal_main_window(app);
        }
        _ => {}
    });
}
