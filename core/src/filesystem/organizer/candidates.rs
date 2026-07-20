//! Detection of misfiled loose files that should be organized.

use std::path::{Path, PathBuf};

use globset::GlobSet;
use walkdir::WalkDir;

use metadata_integrations::parse_comic_filename;

use super::confirm::series_family_key;
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

/// The base "series family" a filename stem parses to (edition/volume folded).
fn family_of(stem: &str) -> String {
	series_family_key(&parse_comic_filename(stem).series.unwrap_or_default())
}

/// Whether a non-root folder looks like a jumble of unrelated series rather than one
/// intentionally-grouped series.
///
/// Heuristic: a tidy folder is *named after its series*, and its files belong to that
/// series family (`Absolute Batman (2025)/` holds `Absolute Batman …`, its Annual, its
/// Noir Edition, even a spin-off — all sharing the `absolute batman` family prefix). A
/// dump (`downloads/`) has a name that doesn't predict its varied contents. So we flag
/// a folder only when a *majority* of its files don't belong to the folder's own family
/// (or the folder name yields no series at all).
fn folder_is_dump(dir: &Path, media: &[PathBuf]) -> bool {
	let folder_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or_default();
	let folder_family = family_of(folder_name);
	if folder_family.is_empty() {
		return true;
	}
	let mismatches = media
		.iter()
		.filter_map(|p| p.file_stem().and_then(|s| s.to_str()))
		.filter(|stem| !family_of(stem).starts_with(&folder_family))
		.count();
	// Strictly more than half of the files don't belong to the folder's series.
	mismatches * 2 > media.len()
}

/// Find files to organize.
///
/// **Root files are always candidates** (the root must never become a series).
///
/// When `include_subfolders` is set (the per-library catch-all opt-in) and the library
/// is SeriesBased, non-root folders whose name doesn't predict their contents are also
/// scanned (see [`folder_is_dump`]). CollectionBased libraries never split subfolders —
/// their top-level folders are intended collections.
pub fn find_candidate_files(
	library_root: &Path,
	include_subfolders: bool,
	is_collection_based: bool,
	ignore: &GlobSet,
) -> Vec<CandidateFile> {
	let mut candidates: Vec<CandidateFile> = direct_media(library_root, ignore)
		.into_iter()
		.map(|path| CandidateFile { path })
		.collect();

	if include_subfolders && !is_collection_based {
		for entry in WalkDir::new(library_root)
			.min_depth(1)
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
			if folder_is_dump(dir, &media) {
				candidates.extend(media.into_iter().map(|path| CandidateFile { path }));
			}
		}
	}

	candidates
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
		let found = find_candidate_files(root.path(), false, false, &GlobSet::empty());
		assert_eq!(found.len(), 2);
	}

	#[test]
	fn subfolders_ignored_when_catchall_off() {
		let root = tempdir().unwrap();
		let sub = root.path().join("downloads");
		fs::create_dir(&sub).unwrap();
		touch(&sub, "Batman 001.cbz");
		touch(&sub, "Superman 001.cbz");
		let found = find_candidate_files(root.path(), false, false, &GlobSet::empty());
		assert!(found.is_empty());
	}

	#[test]
	fn catchall_flags_a_dump_folder() {
		let root = tempdir().unwrap();
		let dump = root.path().join("downloads");
		fs::create_dir(&dump).unwrap();
		touch(&dump, "Batman 001.cbz");
		touch(&dump, "Superman 001.cbz");
		touch(&dump, "The Flash 001.cbz");
		let found = find_candidate_files(root.path(), true, false, &GlobSet::empty());
		assert_eq!(found.len(), 3);
	}

	#[test]
	fn catchall_leaves_tidy_folders_alone() {
		let root = tempdir().unwrap();
		// Multi-volume folder: volume markers fold to one series.
		let vols = root.path().join("King Spawn (v01-v03)");
		fs::create_dir(&vols).unwrap();
		touch(&vols, "King Spawn v01.cbz");
		touch(&vols, "King Spawn v02.cbz");
		touch(&vols, "King Spawn v03.cbz");
		// Series folder with a main run + editions + a spin-off: one family.
		let batman = root.path().join("Absolute Batman (2025)");
		fs::create_dir(&batman).unwrap();
		touch(&batman, "Absolute Batman 001 (2025).cbz");
		touch(&batman, "Absolute Batman 002 (2025).cbz");
		touch(&batman, "Absolute Batman Noir Edition 001 (2025).cbz");
		touch(&batman, "Absolute Batman - Ark M 001 (2026).cbz");
		let found = find_candidate_files(root.path(), true, false, &GlobSet::empty());
		assert!(
			found.is_empty(),
			"tidy folders must not be flagged; got {:?}",
			names(&found)
		);
	}

	#[test]
	fn collection_based_never_splits_subfolders_even_with_catchall() {
		let root = tempdir().unwrap();
		touch(root.path(), "Loose At Root 001.cbz");
		let dump = root.path().join("downloads");
		fs::create_dir(&dump).unwrap();
		touch(&dump, "Batman 001.cbz");
		touch(&dump, "Superman 001.cbz");
		// include_subfolders=true but CollectionBased -> only the root file.
		let found = find_candidate_files(root.path(), true, true, &GlobSet::empty());
		assert_eq!(
			names(&found),
			HashSet::from(["Loose At Root 001.cbz".to_string()])
		);
	}
}
