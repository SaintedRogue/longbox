mod env;
pub mod logging;
mod longbox_config;
pub mod migrate;
pub mod oidc_config;

pub use env::env_var;
use longbox_config::env_keys::{CONFIG_DIR_KEY, IN_DOCKER_KEY};
pub use longbox_config::{defaults, env_keys, LongboxConfig};
pub use oidc_config::OidcConfig;

/// Gets the default config directory located at `~/.longbox` where `~` is the
/// user's home directory.
pub fn get_default_config_dir() -> String {
	let home = dirs::home_dir().expect("Could not determine user home directory");
	let config_dir = home.join(".longbox");

	config_dir.to_string_lossy().into_owned()
}

/// Gets the legacy (pre-rebrand) default config directory located at `~/.stump`, used
/// as the migration source when falling back to [`get_default_config_dir`].
fn get_legacy_default_config_dir() -> std::path::PathBuf {
	let home = dirs::home_dir().expect("Could not determine user home directory");
	home.join(".stump")
}

/// Migrates a pre-existing legacy `~/.stump` directory to `default_dir` (`~/.longbox`)
/// if present, via [`migrate::migrate_legacy_dir`]. No-op if there is nothing to
/// migrate (including if `default_dir` already exists). Migration failures are
/// reported via `eprintln!` (this runs before tracing is initialized, so
/// `tracing::*` calls here would be silently dropped) and otherwise ignored - a
/// failed migration must never block boot, but it also must never look like silent
/// data loss.
fn migrate_default_config_dir(default_dir: &str) {
	let legacy_dir = get_legacy_default_config_dir();
	if let Err(error) =
		migrate::migrate_legacy_dir(&legacy_dir, std::path::Path::new(default_dir))
	{
		eprintln!(
			"Longbox: WARNING failed to migrate {legacy_dir:?} -> {default_dir:?}: \
			 {error}. Your existing data remains at {legacy_dir:?}; the server will \
			 start with a fresh config dir until this is resolved."
		);
	}
}

/// Returns the value of the `LONGBOX_CONFIG_DIR` environment variable (falling back
/// to the legacy `STUMP_CONFIG_DIR`) if it is set, logs an error and returns
/// `~/.longbox` otherwise.
///
/// When falling back to the default directory, this first migrates any pre-existing
/// legacy `~/.stump` directory (and its `Stump.toml`/`Stump.log`/`stump.db*` contents)
/// to `~/.longbox` - see [`migrate_default_config_dir`]. A custom
/// `LONGBOX_CONFIG_DIR`/`STUMP_CONFIG_DIR` is left untouched, since the user is
/// managing that directory themselves.
pub fn bootstrap_config_dir() -> String {
	match env_var(CONFIG_DIR_KEY) {
		// Environment variable set
		Some(config_dir) => {
			if config_dir.is_empty() {
				let default_dir = get_default_config_dir();
				tracing::error!(
					"{} set to an empty value - falling back to {}",
					CONFIG_DIR_KEY,
					default_dir
				);
				migrate_default_config_dir(&default_dir);

				default_dir
			} else {
				config_dir
			}
		},
		// Environment variable not set
		None => {
			let default_dir = get_default_config_dir();
			tracing::error!(
				"{} not set - falling back to {}",
				CONFIG_DIR_KEY,
				default_dir
			);
			migrate_default_config_dir(&default_dir);

			default_dir
		},
	}
}

/// Checks if Stump is running in docker by checking each of:
///   1. The `LONGBOX_IN_DOCKER` (or legacy `STUMP_IN_DOCKER`) environment variable.
///   2. The existence of `/run/.containerenv` and `/.dockerenv`.
///   3. The presence of "docker" or "containerd" processes.
pub fn longbox_in_docker() -> bool {
	let env_set = env_var(IN_DOCKER_KEY).is_some();
	if env_set {
		return true;
	}

	let container_env = std::fs::metadata("/run/.containerenv").is_ok();
	let docker_env = std::fs::metadata("/.dockerenv").is_ok();
	if container_env || docker_env {
		return true;
	}

	// NOTE: this should never hit, since I manually set the env var in the Dockerfile... However,
	// in case someone decides to run Stump in a container while overriding that var, this should
	// prevent any issues.
	std::fs::read_to_string("/proc/self/cgroup")
		.map(|cgroup| {
			cgroup
				.lines()
				.any(|line| line.contains("docker") || line.contains("containerd"))
		})
		.unwrap_or(false)
}
