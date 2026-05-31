mod aria2;
mod commands;
mod models;
mod services;
mod store;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use services::DownloadService;
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path();
            let resource_dir = path.resource_dir()?;
            let app_data_dir = path.app_data_dir()?;
            let default_download_dir = path.download_dir()?;
            app.manage(DownloadService::new(
                resource_dir,
                app_data_dir,
                default_download_dir,
            ));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let service = window.state::<DownloadService>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    service.shutdown().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::list_downloads,
            commands::create_download,
            commands::preview_download,
            commands::retry_download,
            commands::pause_download,
            commands::resume_download,
            commands::update_queue_settings,
            commands::pause_all_downloads,
            commands::resume_all_downloads,
            commands::purge_stopped_downloads,
            commands::remove_download,
            commands::remove_download_with_file,
            commands::open_download_file,
            commands::open_download_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
