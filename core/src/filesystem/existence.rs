//! Helpers for answering "is this still on disk?" safely.
//!
//! These back destructive, user-initiated maintenance actions (library cleanup, permanent
//! book deletion). The overriding concern here is that **"the filesystem said no" and "the
//! filesystem could not answer" are different things**: a detached drive or an unmounted
//! network share makes every book in a library look missing, and treating that as "the user
//! deleted these files" would wipe an entire library's records in one click.

use std::{
	io,
	path::{Path, PathBuf},
};

use futures::{stream, StreamExt};
use tokio::fs;

/// Whether a path could be found on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathPresence {
	/// The path resolved to something on disk.
	Present,
	/// The filesystem definitively reported that nothing exists at the path.
	Missing,
	/// The filesystem could not answer, e.g. permission denied, an I/O error, or a stale
	/// network handle. The path may or may not exist, so callers must **not** treat this
	/// as [`PathPresence::Missing`] when deciding to delete something.
	Indeterminate,
}

/// Determine whether `path` currently resolves to a file or directory on disk.
///
/// Symlinks are followed, so a link whose target has been removed reports
/// [`PathPresence::Missing`] — from a reader's point of view the book really is gone.
pub async fn path_presence(path: impl AsRef<Path>) -> PathPresence {
	let path = path.as_ref();
	match fs::metadata(path).await {
		Ok(_) => PathPresence::Present,
		Err(error) if error.kind() == io::ErrorKind::NotFound => PathPresence::Missing,
		Err(error) => {
			tracing::warn!(
				?error,
				?path,
				"Could not determine whether path exists; treating as indeterminate"
			);
			PathPresence::Indeterminate
		},
	}
}

/// Assert that the storage behind a library root is actually attached before anything is
/// pruned on the strength of files "not existing".
///
/// A root is considered available only when it is a readable, non-empty directory. The
/// emptiness check is the important one: when a network share or external drive detaches,
/// the mount point itself usually survives as an empty directory, so an `exists()` check
/// would happily report that the library is fine while every book underneath it looks
/// deleted.
///
/// A genuinely empty library is therefore reported as unavailable. That is the intended
/// trade-off — there is nothing to clean in an empty library anyway.
pub async fn is_storage_root_available(root: impl AsRef<Path>) -> bool {
	let root = root.as_ref();

	match fs::metadata(root).await {
		Ok(metadata) if metadata.is_dir() => (),
		Ok(_) => {
			tracing::warn!(?root, "Library root is not a directory");
			return false;
		},
		Err(error) => {
			tracing::warn!(?error, ?root, "Library root could not be read");
			return false;
		},
	}

	let mut read_dir = match fs::read_dir(root).await {
		Ok(read_dir) => read_dir,
		Err(error) => {
			tracing::warn!(?error, ?root, "Library root could not be listed");
			return false;
		},
	};

	match read_dir.next_entry().await {
		Ok(Some(_)) => true,
		Ok(None) => {
			tracing::warn!(
				?root,
				"Library root is empty, which usually means its storage is detached"
			);
			false
		},
		Err(error) => {
			tracing::warn!(?error, ?root, "Failed to enumerate library root");
			false
		},
	}
}

/// The outcome of an existence sweep over a set of records.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MissingPaths {
	/// The IDs of records whose path the filesystem definitively reported as gone.
	pub missing_ids: Vec<String>,
	/// How many records could not be checked. These are deliberately left alone.
	pub indeterminate_count: usize,
}

/// Stat every `(id, path)` pair concurrently, up to `concurrency` at a time, and report which
/// records no longer exist.
///
/// Only [`PathPresence::Missing`] lands in [`MissingPaths::missing_ids`] — anything the
/// filesystem refused to answer for is counted separately and left in place.
pub async fn find_missing_paths<I>(entries: I, concurrency: usize) -> MissingPaths
where
	I: IntoIterator<Item = (String, String)>,
{
	let concurrency = concurrency.max(1);

	let results = stream::iter(entries)
		.map(|(id, path)| async move { (id, path_presence(path).await) })
		.buffer_unordered(concurrency)
		.collect::<Vec<_>>()
		.await;

	let mut outcome = MissingPaths::default();
	for (id, presence) in results {
		match presence {
			PathPresence::Present => (),
			PathPresence::Missing => outcome.missing_ids.push(id),
			PathPresence::Indeterminate => outcome.indeterminate_count += 1,
		}
	}
	// Stable output keeps logs and tests deterministic, since `buffer_unordered` completes
	// out of order.
	outcome.missing_ids.sort();

	outcome
}

/// Why a path could not be accepted as living inside a trusted root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathContainmentError {
	/// The root itself could not be resolved, so containment cannot be judged at all.
	RootUnavailable,
	/// The target could not be resolved (it does not exist, or is unreadable).
	TargetUnavailable,
	/// The target resolved to somewhere outside the root.
	OutsideRoot,
}

impl std::fmt::Display for PathContainmentError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::RootUnavailable => write!(f, "The library path is not accessible"),
			Self::TargetUnavailable => write!(f, "The path could not be resolved"),
			Self::OutsideRoot => write!(f, "The path is outside of its library"),
		}
	}
}

impl std::error::Error for PathContainmentError {}

/// Resolve `target` and prove it lives inside `root`, returning the canonical target.
///
/// Both sides are canonicalized first, so `..` segments and symlinks cannot be used to point
/// at something outside the root. Comparison is component-wise, so a sibling root such as
/// `/data/comics-backup` is not accepted for the root `/data/comics`. The root itself is
/// rejected: a caller asking to delete "the book" must never be handed the library folder.
///
/// Callers should treat the returned path — not the original — as the thing to operate on,
/// since that is the path that was actually verified.
pub async fn canonical_path_within(
	root: impl AsRef<Path>,
	target: impl AsRef<Path>,
) -> Result<PathBuf, PathContainmentError> {
	let root = fs::canonicalize(root.as_ref())
		.await
		.map_err(|_| PathContainmentError::RootUnavailable)?;
	let target = fs::canonicalize(target.as_ref())
		.await
		.map_err(|_| PathContainmentError::TargetUnavailable)?;

	if target == root || !target.starts_with(&root) {
		return Err(PathContainmentError::OutsideRoot);
	}

	Ok(target)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn write(path: &Path) {
		std::fs::write(path, b"book").expect("failed to write test file");
	}

	#[tokio::test]
	async fn storage_root_availability_distinguishes_detached_storage() {
		let tempdir = tempfile::tempdir().expect("failed to create tempdir");
		let root = tempdir.path();

		// The case that matters: a mount point that survived its storage detaching. It
		// exists, it is a directory, it is readable — and every book under it would look
		// deleted. It must not be treated as available.
		assert!(!is_storage_root_available(root).await);

		write(&root.join("book.cbz"));
		assert!(is_storage_root_available(root).await);

		assert!(!is_storage_root_available(root.join("nope")).await);
		assert!(!is_storage_root_available(root.join("book.cbz")).await);
	}

	#[tokio::test]
	async fn find_missing_paths_reports_only_definitively_missing_records() {
		let tempdir = tempfile::tempdir().expect("failed to create tempdir");
		let present = tempdir.path().join("present.cbz");
		write(&present);

		let outcome = find_missing_paths(
			vec![
				("present".to_string(), present.display().to_string()),
				(
					"gone".to_string(),
					tempdir.path().join("gone.cbz").display().to_string(),
				),
				(
					"gone-dir".to_string(),
					tempdir
						.path()
						.join("gone/also-gone.cbz")
						.display()
						.to_string(),
				),
			],
			4,
		)
		.await;

		assert_eq!(
			outcome,
			MissingPaths {
				missing_ids: vec!["gone".to_string(), "gone-dir".to_string()],
				indeterminate_count: 0,
			}
		);
	}

	#[tokio::test]
	async fn canonical_path_within_accepts_paths_inside_the_root() {
		let tempdir = tempfile::tempdir().expect("failed to create tempdir");
		let root = tempdir.path();
		let nested = root.join("series");
		std::fs::create_dir(&nested).expect("failed to create dir");
		let book = nested.join("book.cbz");
		write(&book);

		let resolved = canonical_path_within(root, &book)
			.await
			.expect("expected the book to be accepted");
		assert_eq!(
			resolved,
			std::fs::canonicalize(&book).expect("failed to canonicalize")
		);

		// A traversal that stays inside the root is still inside the root
		let looping = nested.join("../series/book.cbz");
		assert!(canonical_path_within(root, looping).await.is_ok());
	}

	#[tokio::test]
	async fn canonical_path_within_rejects_paths_outside_the_root() {
		let tempdir = tempfile::tempdir().expect("failed to create tempdir");
		let root = tempdir.path().join("library");
		std::fs::create_dir(&root).expect("failed to create dir");
		write(&root.join("book.cbz"));

		let outsider = tempdir.path().join("outsider.cbz");
		write(&outsider);

		// Escaping with `..`
		assert_eq!(
			canonical_path_within(&root, root.join("../outsider.cbz")).await,
			Err(PathContainmentError::OutsideRoot)
		);

		// A sibling directory that shares a string prefix with the root. Comparison must be
		// component-wise, not `str::starts_with`.
		let sibling = tempdir.path().join("library-backup");
		std::fs::create_dir(&sibling).expect("failed to create dir");
		let sibling_book = sibling.join("book.cbz");
		write(&sibling_book);
		assert_eq!(
			canonical_path_within(&root, &sibling_book).await,
			Err(PathContainmentError::OutsideRoot)
		);

		// The root itself is never a deletable target
		assert_eq!(
			canonical_path_within(&root, &root).await,
			Err(PathContainmentError::OutsideRoot)
		);

		// A path that does not exist cannot be proven safe
		assert_eq!(
			canonical_path_within(&root, root.join("ghost.cbz")).await,
			Err(PathContainmentError::TargetUnavailable)
		);

		// A root that does not exist cannot judge anything
		assert_eq!(
			canonical_path_within(tempdir.path().join("detached"), &outsider).await,
			Err(PathContainmentError::RootUnavailable)
		);
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn canonical_path_within_rejects_symlinks_escaping_the_root() {
		let tempdir = tempfile::tempdir().expect("failed to create tempdir");
		let root = tempdir.path().join("library");
		std::fs::create_dir(&root).expect("failed to create dir");

		let outsider = tempdir.path().join("secret.cbz");
		write(&outsider);

		// A link that lives inside the library but points out of it
		let link = root.join("innocent.cbz");
		std::os::unix::fs::symlink(&outsider, &link).expect("failed to symlink");
		assert_eq!(
			canonical_path_within(&root, &link).await,
			Err(PathContainmentError::OutsideRoot)
		);

		// A linked *directory* pointing out of the library is equally unsafe
		let outside_dir = tempdir.path().join("elsewhere");
		std::fs::create_dir(&outside_dir).expect("failed to create dir");
		let outside_book = outside_dir.join("book.cbz");
		write(&outside_book);
		let dir_link = root.join("series");
		std::os::unix::fs::symlink(&outside_dir, &dir_link).expect("failed to symlink");
		assert_eq!(
			canonical_path_within(&root, dir_link.join("book.cbz")).await,
			Err(PathContainmentError::OutsideRoot)
		);
	}
}
