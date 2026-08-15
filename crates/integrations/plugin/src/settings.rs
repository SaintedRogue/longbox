//! Reconciling operator-supplied config values against the fields a plugin declares.
//!
//! Kept here, next to the protocol, because the rules are entirely a function of the
//! manifest — no database, no GraphQL — which makes them cheap to test exhaustively.

use std::collections::BTreeMap;

use serde_json::Value;
use thiserror::Error;

use crate::protocol::{PluginConfigFieldType, PluginManifest};

pub type Settings = BTreeMap<String, Value>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SettingsError {
	#[error("`{key}` is required by this plugin")]
	MissingRequired { key: String },

	#[error("`{key}` must be {expected}")]
	WrongType { key: String, expected: String },

	#[error("`{key}` must be one of: {options}")]
	NotAnOption { key: String, options: String },
}

/// Apply `incoming` on top of `stored`, keeping only keys the manifest declares.
///
/// Three rules earn their keep here:
///
/// - **Undeclared keys are dropped, not stored.** A manifest that loses a field must not
///   leave a value behind that nothing will ever render or clear again.
/// - **A blank secret means "keep what you have".** The UI never receives a stored
///   secret, so it cannot send one back; without this, saving an unrelated field would
///   wipe the plugin's credentials. This mirrors how the metadata provider forms treat a
///   blank API token.
/// - **Defaults fill only what was never set**, so a field the operator has deliberately
///   left blank does not silently re-acquire the plugin author's default on every save.
pub fn merge_settings(
	manifest: &PluginManifest,
	stored: &Settings,
	incoming: &Settings,
) -> Result<Settings, SettingsError> {
	let mut merged = Settings::new();

	for field in &manifest.config {
		let submitted = incoming.get(&field.key);

		// A secret arrives either as a real new value or as nothing at all. An empty
		// string is what a form sends for "I did not touch this".
		let submitted = match (field.field_type.is_secret(), submitted) {
			(true, Some(Value::String(s))) if s.is_empty() => None,
			_ => submitted,
		};

		let value = match submitted {
			Some(Value::Null) => None,
			Some(value) => Some(value.clone()),
			None => stored
				.get(&field.key)
				.cloned()
				.or_else(|| field.default.clone().map(Value::String)),
		};

		let Some(value) = value else {
			if field.required {
				return Err(SettingsError::MissingRequired {
					key: field.key.clone(),
				});
			}
			continue;
		};

		validate(
			field.field_type,
			&field.key,
			&value,
			field.options.as_deref(),
		)?;
		merged.insert(field.key.clone(), value);
	}

	Ok(merged)
}

fn validate(
	field_type: PluginConfigFieldType,
	key: &str,
	value: &Value,
	options: Option<&[String]>,
) -> Result<(), SettingsError> {
	let wrong = |expected: &str| SettingsError::WrongType {
		key: key.to_string(),
		expected: expected.to_string(),
	};

	match field_type {
		PluginConfigFieldType::String | PluginConfigFieldType::Secret => {
			value.as_str().map(|_| ()).ok_or_else(|| wrong("text"))
		},
		PluginConfigFieldType::Number => {
			value.as_f64().map(|_| ()).ok_or_else(|| wrong("a number"))
		},
		PluginConfigFieldType::Boolean => value
			.as_bool()
			.map(|_| ())
			.ok_or_else(|| wrong("true or false")),
		PluginConfigFieldType::Select => {
			let chosen = value.as_str().ok_or_else(|| wrong("text"))?;
			let options = options.unwrap_or_default();
			if options.iter().any(|o| o == chosen) {
				Ok(())
			} else {
				Err(SettingsError::NotAnOption {
					key: key.to_string(),
					options: options.join(", "),
				})
			}
		},
	}
}

/// Strip every secret-typed value, for handing settings back to a client.
///
/// A stored secret is never returned, so the UI shows "set / not set" and only sends a
/// value when the operator types a new one.
pub fn redact_settings(manifest: &PluginManifest, stored: &Settings) -> Settings {
	stored
		.iter()
		.filter(|(key, _)| {
			manifest
				.field(key)
				.is_none_or(|field| !field.field_type.is_secret())
		})
		.map(|(key, value)| (key.clone(), value.clone()))
		.collect()
}

/// Which declared secret fields currently hold a value — the "•••• (set)" affordance.
pub fn secret_keys_with_values(
	manifest: &PluginManifest,
	stored: &Settings,
) -> Vec<String> {
	manifest
		.config
		.iter()
		.filter(|field| field.field_type.is_secret())
		.filter(|field| {
			stored
				.get(&field.key)
				.and_then(Value::as_str)
				.is_some_and(|v| !v.is_empty())
		})
		.map(|field| field.key.clone())
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::protocol::PluginConfigField;

	fn field(key: &str, field_type: PluginConfigFieldType) -> PluginConfigField {
		PluginConfigField {
			key: key.to_string(),
			label: key.to_string(),
			field_type,
			required: false,
			default: None,
			options: None,
			help: None,
		}
	}

	fn manifest(config: Vec<PluginConfigField>) -> PluginManifest {
		PluginManifest {
			protocol: 1,
			id: "x".into(),
			name: "X".into(),
			version: None,
			description: None,
			capabilities: vec![],
			config,
		}
	}

	fn settings(pairs: &[(&str, Value)]) -> Settings {
		pairs
			.iter()
			.map(|(k, v)| (k.to_string(), v.clone()))
			.collect()
	}

	#[test]
	fn incoming_values_win_over_stored() {
		let m = manifest(vec![field("region", PluginConfigFieldType::String)]);
		let merged = merge_settings(
			&m,
			&settings(&[("region", Value::from("us"))]),
			&settings(&[("region", Value::from("eu"))]),
		)
		.unwrap();

		assert_eq!(merged["region"], Value::from("eu"));
	}

	/// The UI never receives a stored secret, so it cannot send one back. Saving an
	/// unrelated field must not wipe the plugin's credentials.
	#[test]
	fn a_blank_secret_keeps_the_stored_one() {
		let m = manifest(vec![
			field("api_key", PluginConfigFieldType::Secret),
			field("region", PluginConfigFieldType::String),
		]);

		let merged = merge_settings(
			&m,
			&settings(&[("api_key", Value::from("keep-me"))]),
			&settings(&[("api_key", Value::from("")), ("region", Value::from("eu"))]),
		)
		.unwrap();

		assert_eq!(merged["api_key"], Value::from("keep-me"));
		assert_eq!(merged["region"], Value::from("eu"));
	}

	#[test]
	fn a_non_blank_secret_replaces_the_stored_one() {
		let m = manifest(vec![field("api_key", PluginConfigFieldType::Secret)]);
		let merged = merge_settings(
			&m,
			&settings(&[("api_key", Value::from("old"))]),
			&settings(&[("api_key", Value::from("new"))]),
		)
		.unwrap();

		assert_eq!(merged["api_key"], Value::from("new"));
	}

	/// A manifest that drops a field must not leave a value nothing can render or clear.
	#[test]
	fn undeclared_keys_are_dropped() {
		let m = manifest(vec![field("kept", PluginConfigFieldType::String)]);
		let merged = merge_settings(
			&m,
			&settings(&[("gone", Value::from("stale"))]),
			&settings(&[("kept", Value::from("v")), ("bogus", Value::from("x"))]),
		)
		.unwrap();

		assert_eq!(merged.keys().collect::<Vec<_>>(), vec!["kept"]);
	}

	#[test]
	fn defaults_apply_only_when_nothing_was_ever_set() {
		let mut with_default = field("region", PluginConfigFieldType::String);
		with_default.default = Some("us".into());
		let m = manifest(vec![with_default]);

		let fresh = merge_settings(&m, &Settings::new(), &Settings::new()).unwrap();
		assert_eq!(fresh["region"], Value::from("us"));

		// An explicitly cleared field stays cleared rather than snapping back.
		let cleared = merge_settings(
			&m,
			&settings(&[("region", Value::from("eu"))]),
			&settings(&[("region", Value::Null)]),
		)
		.unwrap();
		assert!(!cleared.contains_key("region"));
	}

	#[test]
	fn required_fields_must_end_up_with_a_value() {
		let mut required = field("api_key", PluginConfigFieldType::Secret);
		required.required = true;
		let m = manifest(vec![required]);

		assert_eq!(
			merge_settings(&m, &Settings::new(), &Settings::new()),
			Err(SettingsError::MissingRequired {
				key: "api_key".into()
			})
		);
	}

	#[test]
	fn types_are_enforced() {
		let m = manifest(vec![
			field("count", PluginConfigFieldType::Number),
			field("on", PluginConfigFieldType::Boolean),
		]);

		let bad_number = merge_settings(
			&m,
			&Settings::new(),
			&settings(&[("count", Value::from("x"))]),
		);
		assert!(matches!(bad_number, Err(SettingsError::WrongType { .. })));

		let bad_bool = merge_settings(
			&m,
			&Settings::new(),
			&settings(&[("on", Value::from("yes"))]),
		);
		assert!(matches!(bad_bool, Err(SettingsError::WrongType { .. })));

		let good = merge_settings(
			&m,
			&Settings::new(),
			&settings(&[("count", Value::from(3)), ("on", Value::from(true))]),
		)
		.unwrap();
		assert_eq!(good["count"], Value::from(3));
		assert_eq!(good["on"], Value::from(true));
	}

	#[test]
	fn select_fields_must_match_a_declared_option() {
		let mut select = field("region", PluginConfigFieldType::Select);
		select.options = Some(vec!["us".into(), "eu".into()]);
		let m = manifest(vec![select]);

		assert!(merge_settings(
			&m,
			&Settings::new(),
			&settings(&[("region", Value::from("mars"))])
		)
		.is_err());

		assert!(merge_settings(
			&m,
			&Settings::new(),
			&settings(&[("region", Value::from("eu"))])
		)
		.is_ok());
	}

	#[test]
	fn redaction_removes_secrets_and_keeps_the_rest() {
		let m = manifest(vec![
			field("api_key", PluginConfigFieldType::Secret),
			field("region", PluginConfigFieldType::String),
		]);
		let stored = settings(&[
			("api_key", Value::from("s3cret")),
			("region", Value::from("eu")),
		]);

		let redacted = redact_settings(&m, &stored);
		assert!(!redacted.contains_key("api_key"));
		assert_eq!(redacted["region"], Value::from("eu"));

		assert_eq!(secret_keys_with_values(&m, &stored), vec!["api_key"]);
		assert!(secret_keys_with_values(&m, &Settings::new()).is_empty());
	}
}
