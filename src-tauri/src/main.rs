// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod db;
pub mod models;
pub mod ssh;
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
            app.manage(ssh::SessionRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::server::add_server,
            commands::server::list_servers,
            commands::server::update_server,
            commands::server::delete_server,
            commands::server::ping_server,
            commands::volume::connect_server,
            commands::volume::disconnect_server,
            commands::volume::test_connection,
            commands::volume::list_volumes,
            commands::volume::get_volume_size,
            commands::volume::check_volumes_on_dest,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
