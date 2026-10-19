// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod db;
pub mod models;
pub mod util;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&handle)
                    .await
                    .expect("failed to initialize database");
                handle.manage(pool);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::server::add_server,
            commands::server::list_servers,
            commands::server::update_server,
            commands::server::delete_server,
            commands::server::ping_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
