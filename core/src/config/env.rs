//! Environment-variable resolution for config reads.
//!
//! [`env_var`] is the single entry point every config read should go through. It
//! reads the given key directly from the process environment.

/// Reads the environment variable `key` directly. Returns `None` if it is unset.
pub fn env_var(key: &str) -> Option<String> {
	std::env::var(key).ok()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn env_var_reads_key_and_returns_none_when_unset() {
		// Unique name to avoid clobbering real config during the test run.
		temp_env::with_var("LONGBOX_TEST_ENV_VAR_XYZ", None::<&str>, || {
			assert_eq!(env_var("LONGBOX_TEST_ENV_VAR_XYZ"), None);
		});

		temp_env::with_var("LONGBOX_TEST_ENV_VAR_XYZ", Some("some-value"), || {
			assert_eq!(
				env_var("LONGBOX_TEST_ENV_VAR_XYZ"),
				Some("some-value".to_string())
			);
		});
	}
}
