use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;

const PIPE_NAME: &str = r"\\.\pipe\signageos-watchdog";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCredentials {
    pub screen_id: String,
    pub screen_name: String,
    pub device_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogHeartbeat {
    pub manifest_version: u64,
    pub playback_state: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub detail: String,
}

fn app_data_root() -> PathBuf {
    if let Ok(program_data) = std::env::var("ProgramData") {
        PathBuf::from(program_data).join("SignageOS")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".signageos")
    } else {
        PathBuf::from(".signageos")
    }
}

fn creds_path() -> PathBuf {
    app_data_root().join("credentials.dpapi")
}

#[cfg(windows)]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::HLOCAL;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("DPAPI protect failed: {e}"))?;
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = windows::Win32::Foundation::LocalFree(HLOCAL(output.pbData as _));
        Ok(slice)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::HLOCAL;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: cipher.len() as u32,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("DPAPI unprotect failed: {e}"))?;
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = windows::Win32::Foundation::LocalFree(HLOCAL(output.pbData as _));
        Ok(slice)
    }
}

#[cfg(not(windows))]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(windows))]
fn dpapi_unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
    Ok(cipher.to_vec())
}

#[tauri::command]
pub fn dpapi_load_credentials() -> Result<Option<DeviceCredentials>, String> {
    let path = creds_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read(&path).map_err(|e| e.to_string())?;
    let plain = dpapi_unprotect(&raw)?;
    let creds = serde_json::from_slice::<DeviceCredentials>(&plain).map_err(|e| e.to_string())?;
    Ok(Some(creds))
}

#[tauri::command]
pub fn dpapi_save_credentials(creds: DeviceCredentials) -> Result<(), String> {
    let path = creds_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec(&creds).map_err(|e| e.to_string())?;
    let protected = dpapi_protect(&json)?;
    fs::write(&path, protected).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dpapi_clear_credentials() -> Result<(), String> {
    let path = creds_path();
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn sync_blob_to_disk(sha256: String, url: String) -> Result<String, String> {
    let blobs_dir = app_data_root().join("blobs");
    fs::create_dir_all(&blobs_dir).map_err(|e| e.to_string())?;
    let target = blobs_dir.join(&sha256);
    if target.exists() {
        return Ok(target.to_string_lossy().to_string());
    }

    let part = blobs_dir.join(format!("{sha256}.part"));
    let existing_len = part.metadata().map(|m| m.len()).unwrap_or(0);
    let client = reqwest::blocking::Client::new();
    let mut req = client.get(&url);
    if existing_len > 0 {
        req = req.header("Range", format!("bytes={existing_len}-"));
    }
    let mut resp = req.send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() && resp.status().as_u16() != 206 {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let append = resp.status().as_u16() == 206 && existing_len > 0;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&part)
        .map_err(|e| e.to_string())?;
    std::io::copy(&mut resp, &mut file).map_err(|e| e.to_string())?;

    let mut check = File::open(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = check.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != sha256 {
        let _ = fs::remove_file(&part);
        return Err("SHA-256 mismatch on downloaded blob".to_string());
    }
    fs::rename(&part, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn capture_and_upload_screenshot(upload_url: String) -> Result<ScreenshotResult, String> {
    let _ = upload_url;
    Ok(ScreenshotResult {
        detail: "Session 1 screenshot hook ready".to_string(),
    })
}

#[tauri::command]
pub fn set_system_volume(level: u8) -> Result<(), String> {
    let _clamped = level.min(100);
    Ok(())
}

#[tauri::command]
pub fn set_ddcci_power(standby: bool) -> Result<(), String> {
    let _vcp_d6 = if standby { 0x04 } else { 0x01 };
    Ok(())
}

#[tauri::command]
pub fn trigger_os_reboot() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("shutdown")
            .args(["/r", "/t", "5"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn send_watchdog_heartbeat(payload: WatchdogHeartbeat) -> Result<(), String> {
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    if let Ok(mut pipe) = OpenOptions::new().write(true).open(PIPE_NAME) {
        let _ = writeln!(pipe, "{json}");
    }
    Ok(())
}
