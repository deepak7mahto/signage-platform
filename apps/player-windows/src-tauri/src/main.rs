#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod usb;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bridge::dpapi_load_credentials,
            bridge::dpapi_save_credentials,
            bridge::dpapi_clear_credentials,
            bridge::sync_blob_to_disk,
            bridge::capture_and_upload_screenshot,
            bridge::set_system_volume,
            bridge::set_ddcci_power,
            bridge::trigger_os_reboot,
            bridge::send_watchdog_heartbeat,
            usb::read_usb_provision_config,
        ])
        .run(tauri::generate_context!())
        .expect("error running SignageOS Windows player");
}
