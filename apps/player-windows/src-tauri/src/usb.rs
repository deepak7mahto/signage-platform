use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbProvisionConfig {
    pub server_url: String,
    pub provision_token: String,
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        for letter in b'D'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            paths.push(PathBuf::from(root).join("signage-provision.json"));
        }
    }
    if let Ok(program_data) = std::env::var("ProgramData") {
        paths.push(PathBuf::from(program_data).join("SignageOS").join("signage-provision.json"));
    }
    paths
}

#[tauri::command]
pub fn read_usb_provision_config() -> Option<UsbProvisionConfig> {
    for path in candidate_paths() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<UsbProvisionConfig>(&raw) {
                if !cfg.provision_token.trim().is_empty() {
                    return Some(cfg);
                }
            }
        }
    }
    None
}
