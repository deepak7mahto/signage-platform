use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const HEARTBEAT_TIMEOUT_MS: u64 = 15_000;
pub const MAX_PROCESS_RESTARTS: u32 = 2;
pub const MAX_REBOOTS_PER_HOUR: usize = 3;
pub const REBOOT_WINDOW_MS: u64 = 3_600_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogState {
    pub reboot_timestamps_ms: Vec<u64>,
    pub process_restart_attempts: u32,
    pub rolled_back_lkg: bool,
    pub safe_mode: bool,
    pub last_heartbeat_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    Healthy,
    RestartTauriHost,
    RollbackLkgAndRestart,
    OsReboot,
    EnterSafeModeSlate,
}

pub struct WatchdogPolicy {
    state_path: PathBuf,
    state: WatchdogState,
}

impl WatchdogPolicy {
    pub fn load(state_path: PathBuf) -> Self {
        let state = fs::read_to_string(&state_path)
            .ok()
            .and_then(|s| serde_json::from_str::<WatchdogState>(&s).ok())
            .unwrap_or_default();
        Self { state_path, state }
    }

    pub fn record_heartbeat(&mut self, now_ms: u64) {
        self.state.last_heartbeat_ms = now_ms;
        self.state.process_restart_attempts = 0;
        self.save();
    }

    pub fn evaluate_timeout(&mut self, now_ms: u64) -> RecoveryAction {
        if self.state.safe_mode {
            return RecoveryAction::EnterSafeModeSlate;
        }
        if now_ms.saturating_sub(self.state.last_heartbeat_ms) < HEARTBEAT_TIMEOUT_MS {
            return RecoveryAction::Healthy;
        }

        if self.state.process_restart_attempts < MAX_PROCESS_RESTARTS {
            self.state.process_restart_attempts += 1;
            self.state.last_heartbeat_ms = now_ms;
            self.save();
            return RecoveryAction::RestartTauriHost;
        }

        if !self.state.rolled_back_lkg {
            self.state.rolled_back_lkg = true;
            self.state.last_heartbeat_ms = now_ms;
            self.save();
            return RecoveryAction::RollbackLkgAndRestart;
        }

        let cutoff = now_ms.saturating_sub(REBOOT_WINDOW_MS);
        self.state.reboot_timestamps_ms.retain(|&ts| ts >= cutoff);
        if self.state.reboot_timestamps_ms.len() >= MAX_REBOOTS_PER_HOUR {
            self.state.safe_mode = true;
            self.save();
            return RecoveryAction::EnterSafeModeSlate;
        }

        self.state.reboot_timestamps_ms.push(now_ms);
        self.state.process_restart_attempts = 0;
        self.save();
        RecoveryAction::OsReboot
    }

    pub fn state(&self) -> &WatchdogState {
        &self.state
    }

    fn save(&self) {
        if let Some(parent) = self.state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.state) {
            let _ = fs::write(&self.state_path, json);
        }
    }
}

#[cfg(windows)]
mod windows_svc {
    use std::ffi::OsString;
    use std::time::Duration;
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    const SERVICE_NAME: &str = "SignageWatchdogService";
    define_windows_service!(ffi_service_main, service_main);

    pub fn run() -> windows_service::Result<()> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)
    }

    fn service_main(_args: Vec<OsString>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let handler = move |control_event| -> ServiceControlHandlerResult {
            match control_event {
                ServiceControl::Stop | ServiceControl::Interrogate => {
                    if matches!(control_event, ServiceControl::Stop) {
                        let _ = tx.send(());
                    }
                    ServiceControlHandlerResult::NoError
                }
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        };

        if let Ok(status_handle) = service_control_handler::register(SERVICE_NAME, handler) {
            let _ = status_handle.set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: ServiceState::Running,
                controls_accepted: ServiceControlAccept::STOP,
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint: Duration::default(),
                process_id: None,
            });
            while rx.recv_timeout(Duration::from_secs(5)).is_err() {}
            let _ = status_handle.set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: ServiceState::Stopped,
                controls_accepted: ServiceControlAccept::empty(),
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint: Duration::default(),
                process_id: None,
            });
        }
    }
}

fn main() {
    #[cfg(windows)]
    {
        let _ = windows_svc::run();
    }
    #[cfg(not(windows))]
    {
        println!("signage-watchdog-service policy engine ready (Windows Session 0 host required).");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escalation_reaches_safe_mode_after_3_reboots() {
        let tmp = std::env::temp_dir().join("signage_wd_test_state.json");
        let _ = fs::remove_file(&tmp);
        let mut policy = WatchdogPolicy::load(tmp.clone());

        let t0 = 1_700_000_000_000u64;
        policy.record_heartbeat(t0);
        assert_eq!(policy.evaluate_timeout(t0 + 5_000), RecoveryAction::Healthy);
        assert_eq!(policy.evaluate_timeout(t0 + 20_000), RecoveryAction::RestartTauriHost);
        assert_eq!(policy.evaluate_timeout(t0 + 40_000), RecoveryAction::RestartTauriHost);
        assert_eq!(policy.evaluate_timeout(t0 + 60_000), RecoveryAction::RollbackLkgAndRestart);
        assert_eq!(policy.evaluate_timeout(t0 + 80_000), RecoveryAction::OsReboot);
        assert_eq!(policy.evaluate_timeout(t0 + 100_000), RecoveryAction::OsReboot);
        assert_eq!(policy.evaluate_timeout(t0 + 120_000), RecoveryAction::OsReboot);
        assert_eq!(policy.evaluate_timeout(t0 + 140_000), RecoveryAction::EnterSafeModeSlate);
        assert!(policy.state().safe_mode);

        let _ = fs::remove_file(&tmp);
    }
}
