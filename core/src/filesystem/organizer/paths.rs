//! Filesystem-safe destination paths for organized comic files.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Characters disallowed in folder names across common filesystems.
const ILLEGAL: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Turn a provider-supplied series title into a filesystem-safe folder name:
/// replace illegal/control chars with spaces, collapse whitespace, trim, and cap
/// length. Never returns empty (falls back to "Unknown Series").
pub fn sanitize_folder_name(name: &str) -> String {
	let replaced: String = name
		.chars()
		.map(|c| {
			if ILLEGAL.contains(&c) || c.is_control() {
				' '
			} else {
				c
			}
		})
		.collect();
	let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
	let capped: String = collapsed
		.trim_end_matches('.')
		.trim()
		.chars()
		.take(120)
		.collect();
	let capped = capped.trim().to_string();
	if capped.is_empty() {
		"Unknown Series".to_string()
	} else {
		capped
	}
}

/// Build the series folder name: `"Name (Year)"` when a year is present, else `"Name"`.
pub fn series_folder_name(canonical: &str, year: Option<i32>) -> String {
	let base = sanitize_folder_name(canonical);
	match year {
		Some(y) => format!("{base} ({y})"),
		None => base,
	}
}

/// Destination for a file organized into `folder_name` under the library root,
/// preserving the original filename.
pub fn destination_path(
	library_root: &Path,
	folder_name: &str,
	original_filename: &OsStr,
) -> PathBuf {
	library_root.join(folder_name).join(original_filename)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sanitizes_illegal_characters_and_whitespace() {
		assert_eq!(
			sanitize_folder_name("Batman: Year   One"),
			"Batman Year One"
		);
		assert_eq!(sanitize_folder_name("A/B\\C*?"), "A B C");
	}

	#[test]
	fn empty_name_falls_back() {
		assert_eq!(sanitize_folder_name("   "), "Unknown Series");
		assert_eq!(sanitize_folder_name("///"), "Unknown Series");
	}

	#[test]
	fn folder_name_includes_year_when_present() {
		assert_eq!(series_folder_name("Batman", Some(2016)), "Batman (2016)");
		assert_eq!(series_folder_name("Batman", None), "Batman");
	}

	#[test]
	fn destination_joins_root_folder_and_filename() {
		let dst = destination_path(
			Path::new("/lib/data"),
			"Batman (2016)",
			OsStr::new("Batman 001.cbz"),
		);
		assert_eq!(dst, PathBuf::from("/lib/data/Batman (2016)/Batman 001.cbz"));
	}
}
