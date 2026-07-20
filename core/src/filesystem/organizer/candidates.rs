//! Detection of misfiled loose files that should be organized.

use std::path::{Path, PathBuf};

use globset::GlobSet;

use crate::filesystem::PathUtils;

/// A loose file selected for organizing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateFile {
	pub path: PathBuf,
}

/// The direct (non-recursive), non-ignored media files in `dir`.
fn direct_media(dir: &Path, ignore: &GlobSet) -> Vec<PathBuf> {
	let read = match std::fs::read_dir(dir) {
		Ok(read) => read,
		Err(error) => {
			tracing::warn!(
				?error,
				?dir,
				"Failed to read directory during organize scan"
			);
			return vec![];
		},
	};
	read.filter_map(Result::ok)
		.map(|entry| entry.path())
		.filter(|path| {
			path.is_file() && !path.is_default_ignored() && !ignore.is_match(path)
		})
		.collect()
}

/// Find files to organize.
///
/// **Root-only.** Files loose directly in the library root are candidates (the root
/// must never become a series). Subfolders are deliberately left untouched.
///
/// Catch-all subfolder detection — treating a non-root folder that mixes 2+ distinct
/// series as a messy dump — is intentionally deferred. The filename parser can't yet
/// tell volume markers (`v01`/`v02`) or edition variants (`Annual`, `Noir Edition`)
/// apart from genuinely distinct series, so it over-flags tidy multi-volume/edition
/// folders (e.g. `King Spawn (v01-v03)`, `Absolute Batman (2025)`). Until the parser
/// is hardened, only the library root is scanned — the common, safe case.
pub fn find_candidate_files(library_root: &Path, ignore: &GlobSet) -> Vec<CandidateFile> {
	direct_media(library_root, ignore)
		.into_iter()
		.map(|path| CandidateFile { path })
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::collections::HashSet;
	use std::fs;
	use tempfile::tempdir;

	fn touch(dir: &Path, name: &str) {
		fs::write(dir.join(name), b"x").unwrap();
	}

	fn names(candidates: &[CandidateFile]) -> HashSet<String> {
		candidates
			.iter()
			.map(|c| c.path.file_name().unwrap().to_string_lossy().to_string())
			.collect()
	}

	#[test]
	fn root_loose_files_are_candidates() {
		let root = tempdir().unwrap();
		touch(root.path(), "Jays of Future Past 001.cbz");
		touch(root.path(), "Some Other Comic 001.cbz");
		let found = find_candidate_files(root.path(), &GlobSet::empty());
		assert_eq!(found.len(), 2);
	}

	#[test]
	fn subfolders_are_never_candidates() {
		let root = tempdir().unwrap();
		// A tidy multi-volume folder AND a genuinely-mixed folder are BOTH left alone,
		// because root-only scanning never descends into subfolders.
		let clean = root.path().join("King Spawn (v01-v03)");
		fs::create_dir(&clean).unwrap();
		touch(&clean, "King Spawn v01.cbz");
		touch(&clean, "King Spawn v02.cbz");
		let mixed = root.path().join("downloads");
		fs::create_dir(&mixed).unwrap();
		touch(&mixed, "Batman 001.cbz");
		touch(&mixed, "Superman 001.cbz");
		let found = find_candidate_files(root.path(), &GlobSet::empty());
		assert!(found.is_empty());
	}

	#[test]
	fn only_root_files_are_taken_from_a_mixed_tree() {
		let root = tempdir().unwrap();
		touch(root.path(), "Loose At Root 001.cbz");
		let sub = root.path().join("Absolute Batman (2025)");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Absolute Batman 001.cbz");
		touch(&sub, "Absolute Batman Noir Edition 001.cbz");
		let found = find_candidate_files(root.path(), &GlobSet::empty());
		assert_eq!(
			names(&found),
			HashSet::from(["Loose At Root 001.cbz".to_string()])
		);
	}

	#[test]
	fn ignored_files_are_excluded_from_the_root() {
		use globset::{Glob, GlobSetBuilder};
		let root = tempdir().unwrap();
		touch(root.path(), "Keep Me 001.cbz");
		touch(root.path(), "skip-me.cbz");
		let ignore = GlobSetBuilder::new()
			.add(Glob::new("**/skip-*").unwrap())
			.build()
			.unwrap();
		let found = find_candidate_files(root.path(), &ignore);
		assert_eq!(
			names(&found),
			HashSet::from(["Keep Me 001.cbz".to_string()])
		);
	}
}
