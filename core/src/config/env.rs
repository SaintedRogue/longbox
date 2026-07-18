//! Environment-variable resolution for the `STUMP_` -> `LONGBOX_` rebrand.
//!
//! [`env_var`] is the single entry point every config read should go through. It
//! reads the given (new, `LONGBOX_`-prefixed) key directly, and if that's unset
//! falls back to the legacy `STUMP_` variant, emitting a one-time deprecation
//! warning the first time each legacy key is actually used.

use std::{
	collections::HashSet,
	sync::{Mutex, OnceLock},
};

const LEGACY_PREFIX: &str = "STUMP_";
const NEW_PREFIX: &str = "LONGBOX_";

fn warned_legacy_keys() -> &'static Mutex<HashSet<String>> {
	static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
	WARNED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Emits a `tracing::warn!` the first time a given legacy environment variable key
/// is actually relied upon (i.e., its `LONGBOX_` replacement was unset). Subsequent
/// calls for the same key are silent.
fn warn_once(legacy_key: &str) {
	let mut warned = warned_legacy_keys()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());

	if warned.insert(legacy_key.to_string()) {
		tracing::warn!(
			"The `{legacy_key}` environment variable is deprecated. Please migrate to \
			 its `{NEW_PREFIX}`-prefixed replacement; support for the legacy name will \
			 be removed in a future release."
		);
	}
}

/// Reads the environment variable `key`. If `key` is unset and starts with
/// `LONGBOX_`, falls back to the corresponding legacy `STUMP_` variable (e.g.
/// `LONGBOX_PORT` -> `STUMP_PORT`), emitting a one-time deprecation warning the
/// first time the fallback is used. Returns `None` if neither is set.
pub fn env_var(key: &str) -> Option<String> {
	if let Ok(value) = std::env::var(key) {
		return Some(value);
	}

	let rest = key.strip_prefix(NEW_PREFIX)?;
	let legacy_key = format!("{LEGACY_PREFIX}{rest}");
	let value = std::env::var(&legacy_key).ok()?;
	warn_once(&legacy_key);
	Some(value)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn env_var_prefers_new_then_falls_back_to_legacy() {
		// Unique names to avoid clobbering real config during the test run.
		temp_env::with_vars(
			[
				("LONGBOX_TEST_ENV_VAR_XYZ", None::<&str>),
				("STUMP_TEST_ENV_VAR_XYZ", None::<&str>),
			],
			|| {
				assert_eq!(env_var("LONGBOX_TEST_ENV_VAR_XYZ"), None);
			},
		);

		temp_env::with_vars(
			[
				("LONGBOX_TEST_ENV_VAR_XYZ", None::<&str>),
				("STUMP_TEST_ENV_VAR_XYZ", Some("legacy-value")),
			],
			|| {
				assert_eq!(
					env_var("LONGBOX_TEST_ENV_VAR_XYZ"),
					Some("legacy-value".to_string())
				);
			},
		);

		temp_env::with_vars(
			[
				("LONGBOX_TEST_ENV_VAR_XYZ", Some("new-value")),
				("STUMP_TEST_ENV_VAR_XYZ", Some("legacy-value")),
			],
			|| {
				assert_eq!(
					env_var("LONGBOX_TEST_ENV_VAR_XYZ"),
					Some("new-value".to_string())
				);
			},
		);
	}
}
