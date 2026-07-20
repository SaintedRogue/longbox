//! Pattern-aware detection of misfiled loose files that should be organized.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use globset::GlobSet;
use walkdir::WalkDir;

use metadata_integrations::parse_comic_filename;

use super::confirm::normalize_series_key;
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

/// Count the distinct normalized series parsed from a set of files.
fn distinct_series_count(files: &[PathBuf]) -> usize {
	files
		.iter()
		.filter_map(|path| path.file_stem().and_then(|s| s.to_str()))
		.filter_map(|stem| parse_comic_filename(stem).series)
		.map(|series| normalize_series_key(&series))
		.collect::<HashSet<_>>()
		.len()
}

/// Find files to organize:
/// - **library root**: all direct media are candidates (the root must never be a series);
/// - **SeriesBased non-root folder**: candidates only if its direct media resolve to
///   >= 2 distinct series (a catch-all dump); a clean single-series folder is left alone;
/// - **CollectionBased non-root folder**: never candidates (respected as an intended
///   collection).
pub fn find_candidate_files(
	library_root: &Path,
	is_collection_based: bool,
	ignore: &GlobSet,
) -> Vec<CandidateFile> {
	let root_str = library_root.to_string_lossy().to_string();
	let mut candidates = Vec::new();

	for entry in WalkDir::new(library_root)
		.min_depth(0)
		.into_iter()
		.filter_map(Result::ok)
	{
		let dir = entry.path();
		if !dir.is_dir() {
			continue;
		}
		let media = direct_media(dir, ignore);
		if media.is_empty() {
			continue;
		}

		let is_root = dir.to_string_lossy() == root_str;
		let take = if is_root {
			true
		} else if is_collection_based {
			false
		} else {
			distinct_series_count(&media) >= 2
		};

		if take {
			candidates.extend(media.into_iter().map(|path| CandidateFile { path }));
		}
	}

	candidates
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::tempdir;

	fn touch(dir: &Path, name: &str) {
		fs::write(dir.join(name), b"x").unwrap();
	}

	fn paths(candidates: &[CandidateFile]) -> HashSet<String> {
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
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert_eq!(paths(&found).len(), 2);
	}

	#[test]
	fn series_based_catchall_folder_is_candidate() {
		let root = tempdir().unwrap();
		let sub = root.path().join("downloads");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Batman 001.cbz");
		touch(&sub, "Superman 001.cbz"); // 2 distinct series -> catch-all
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert_eq!(paths(&found).len(), 2);
	}

	#[test]
	fn series_based_clean_folder_is_left_alone() {
		let root = tempdir().unwrap();
		let sub = root.path().join("Batman");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Batman 001.cbz");
		touch(&sub, "Batman 002.cbz"); // 1 distinct series -> already correct
		let found = find_candidate_files(root.path(), false, &GlobSet::empty());
		assert!(found.is_empty());
	}

	#[test]
	fn collection_based_subfolders_are_never_split_but_root_is() {
		let root = tempdir().unwrap();
		touch(root.path(), "Loose At Root 001.cbz"); // root is always eligible
		let collection = root.path().join("Marvel");
		fs::create_dir(&collection).unwrap();
		touch(&collection, "Batman 001.cbz");
		touch(&collection, "Superman 001.cbz"); // intended collection, do NOT split
		let found = find_candidate_files(root.path(), true, &GlobSet::empty());
		assert_eq!(
			paths(&found),
			HashSet::from(["Loose At Root 001.cbz".to_string()])
		);
	}
}
