use std::{
	collections::HashMap,
	fs::File,
	io::{Read, Seek},
	path::{Component, PathBuf},
};
use tracing::{debug, error, trace};

use crate::{
	config::LongboxConfig,
	filesystem::{
		content_type::ContentType,
		error::FileError,
		hash,
		media::{
			process::{AnalyzedPage, FileProcessor, FileProcessorOptions, ProcessedFile},
			utils::{metadata_from_buf, sort_file_names},
			ProcessedFileHashes, ProcessedMediaMetadata,
		},
		FileParts, PathUtils,
	},
};

/// Whether a zip entry name refers to a directory.
///
/// Mirrors [`zip::read::ZipFile::is_dir`], which is itself defined purely in terms of the entry
/// name -- opening the entry to ask is pure overhead.
fn is_dir_entry(name: &str) -> bool {
	name.chars()
		.next_back()
		.is_some_and(|c| c == '/' || c == '\\')
}

/// Mirrors [`zip::read::ZipFile::enclosed_name`], derived from the entry name alone.
///
/// Zip entry names are attacker-controlled, so this keeps the crate's traversal rejection intact:
/// NUL bytes, drive prefixes, absolute paths, and `..` segments which climb above the archive
/// root all yield `None`.
fn enclosed_name(name: &str) -> Option<PathBuf> {
	if name.contains('\0') {
		return None;
	}

	let path = PathBuf::from(name);
	let mut depth = 0usize;
	for component in path.components() {
		match component {
			Component::Prefix(_) | Component::RootDir => return None,
			Component::ParentDir => depth = depth.checked_sub(1)?,
			Component::Normal(_) => depth += 1,
			Component::CurDir => (),
		}
	}

	Some(path)
}

/// Resolve a zip entry name to the path used for the hidden-file and content-type checks,
/// preserving the previous `enclosed_name().unwrap_or_else(|| PathBuf::from(name))` behaviour.
fn entry_path(name: &str) -> PathBuf {
	enclosed_name(name).unwrap_or_else(|| {
		tracing::warn!("Failed to get enclosed name for zip entry");
		PathBuf::from(name)
	})
}

/// Build the ordered list of image entries (name + content type) in an archive **without opening a
/// single entry**.
///
/// `by_name`/`by_index` seek to and parse an entry's local file header, so testing each candidate
/// by opening it made page lookup cost O(page) header parses -- on a 1118 page / 2.12GB CBZ that
/// was 0.21s for page 1 versus 3.6s for page 1000. Every predicate needed here (directory-ness,
/// hidden-ness, content type) is derivable from the entry name alone, so none of that is required.
///
/// The names are sorted with [`sort_file_names`] before filtering, exactly as the per-entry loops
/// used to do.
fn sorted_image_entries<R>(archive: &zip::ZipArchive<R>) -> Vec<(String, ContentType)>
where
	R: Read + Seek,
{
	let mut file_names = archive.file_names().collect::<Vec<_>>();
	sort_file_names(&mut file_names);

	file_names
		.into_iter()
		.filter_map(|name| {
			if is_dir_entry(name) {
				return None;
			}

			let path = entry_path(name);
			if path.is_hidden_file() {
				trace!(?path, "Skipping hidden file");
				return None;
			}

			let content_type = path.naive_content_type();
			content_type
				.is_image()
				.then(|| (name.to_string(), content_type))
		})
		.collect()
}

/// Index into the ordered image entries with a 1-based page number, returning `None` for any page
/// outside the archive (including zero and negative pages).
fn image_entry_for_page(
	images: &[(String, ContentType)],
	page: i32,
) -> Option<&(String, ContentType)> {
	let index = usize::try_from(page).ok()?.checked_sub(1)?;
	images.get(index)
}

/// A file processor for ZIP files.
pub struct ZipProcessor;

impl FileProcessor for ZipProcessor {
	fn get_sample_size(path: &str) -> Result<u64, FileError> {
		let zip_file = File::open(path)?;
		let mut archive = zip::ZipArchive::new(zip_file)?;

		let mut sample_size = 0;

		for i in 0..archive.len() {
			if i > 5 {
				break;
			}

			if let Ok(file) = archive.by_index(i) {
				sample_size += file.size();
			}
		}

		// TODO: sample size needs to be > 0...
		Ok(sample_size)
	}

	fn generate_longbox_hash(path: &str) -> Option<String> {
		let sample_result = Self::get_sample_size(path);

		if let Ok(sample) = sample_result {
			match hash::generate(path, sample) {
				Ok(digest) => Some(digest),
				Err(e) => {
					debug!(error = ?e, path, "Failed to digest zip file");

					None
				},
			}
		} else {
			None
		}
	}

	fn generate_hashes(
		path: &str,
		FileProcessorOptions {
			generate_file_hashes,
			// generate_koreader_hashes,
			..
		}: FileProcessorOptions,
	) -> Result<ProcessedFileHashes, FileError> {
		let hash = generate_file_hashes
			.then(|| ZipProcessor::generate_longbox_hash(path))
			.flatten();
		// TODO(koreader): Do we want to hash ZIP files?
		// let koreader_hash = generate_koreader_hashes
		// 	.then(|| generate_koreader_hash(path))
		// 	.transpose()?;

		Ok(ProcessedFileHashes {
			hash,
			koreader_hash: None,
		})
	}

	fn process_metadata(path: &str) -> Result<Option<ProcessedMediaMetadata>, FileError> {
		let zip_file = File::open(path)?;
		let mut archive = zip::ZipArchive::new(zip_file)?;

		let mut metadata = None;

		for i in 0..archive.len() {
			let mut file = archive.by_index(i)?;

			if file.is_dir() {
				trace!("Skipping directory");
				continue;
			}

			let path_buf = file.enclosed_name().unwrap_or_else(|| {
				tracing::warn!("Failed to get enclosed name for zip entry");
				PathBuf::from(file.name())
			});
			let path = path_buf.as_path();

			if path.is_hidden_file() {
				trace!(path = ?path, "Skipping hidden file");
				continue;
			}

			let FileParts { file_name, .. } = path.file_parts();

			if file_name == "ComicInfo.xml" {
				trace!("Found ComicInfo.xml");
				let mut contents = Vec::new();
				file.read_to_end(&mut contents)?;
				let contents = String::from_utf8_lossy(&contents).to_string();
				trace!(contents_len = contents.len(), "Read ComicInfo.xml");
				metadata = metadata_from_buf(&contents);
				break;
			}
		}

		Ok(metadata)
	}

	fn process(
		path: &str,
		options: FileProcessorOptions,
		_: &LongboxConfig,
	) -> Result<ProcessedFile, FileError> {
		let zip_file = File::open(path)?;
		let mut archive = zip::ZipArchive::new(zip_file)?;

		let mut metadata = None;
		let mut pages = 0;

		let ProcessedFileHashes {
			hash,
			koreader_hash,
		} = Self::generate_hashes(path, options)?;

		for i in 0..archive.len() {
			let mut file = archive.by_index(i)?;

			if file.is_dir() {
				trace!("Skipping directory");
				continue;
			}

			let path_buf = file.enclosed_name().unwrap_or_else(|| {
				tracing::warn!("Failed to get enclosed name for zip entry");
				PathBuf::from(file.name())
			});
			let path = path_buf.as_path();

			if path.is_hidden_file() {
				trace!(path = ?path, "Skipping hidden file");
				continue;
			}

			let content_type = path.naive_content_type();
			let FileParts { file_name, .. } = path.file_parts();

			if file_name == "ComicInfo.xml" && options.process_metadata {
				trace!("Found ComicInfo.xml");
				let mut contents = Vec::new();
				file.read_to_end(&mut contents)?;
				let contents = String::from_utf8_lossy(&contents).to_string();
				trace!(contents_len = contents.len(), "Read ComicInfo.xml");
				metadata = metadata_from_buf(&contents);
			} else if content_type.is_image() {
				pages += 1;
			}
		}

		Ok(ProcessedFile {
			path: PathBuf::from(path),
			hash,
			koreader_hash,
			metadata,
			pages,
		})
	}

	fn get_page(
		path: &str,
		page: i32,
		_: &LongboxConfig,
	) -> Result<(ContentType, Vec<u8>), FileError> {
		let zip_file = File::open(path)?;
		let mut archive = zip::ZipArchive::new(&zip_file)?;

		if archive.is_empty() {
			error!(path, "Empty zip file");
			return Err(FileError::ArchiveEmptyError);
		}

		let images = sorted_image_entries(&archive);
		let Some((name, content_type)) = image_entry_for_page(&images, page).cloned()
		else {
			error!(page, path, "Failed to find valid image in zip file");
			return Err(FileError::NoImageError);
		};

		trace!(?name, page, ?content_type, "Found targeted zip entry");

		// Exactly one entry is opened: opening seeks to and parses a local file header, which is
		// what made this O(page) before.
		let mut file = archive.by_name(&name)?;
		let mut contents = Vec::new();
		file.read_to_end(&mut contents)?;
		trace!(contents_len = contents.len(), "Read zip entry");

		Ok((content_type, contents))
	}

	fn get_page_count(path: &str, _: &LongboxConfig) -> Result<i32, FileError> {
		let zip_file = File::open(path)?;
		let archive = zip::ZipArchive::new(&zip_file)?;

		if archive.is_empty() {
			error!(path, "Empty zip file");
			return Err(FileError::ArchiveEmptyError);
		}

		let pages = sorted_image_entries(&archive).len();

		Ok(i32::try_from(pages).unwrap_or(i32::MAX))
	}

	fn get_page_content_types(
		path: &str,
		pages: Vec<i32>,
	) -> Result<HashMap<i32, ContentType>, FileError> {
		let zip_file = File::open(path)?;
		let archive = zip::ZipArchive::new(&zip_file)?;

		if archive.is_empty() {
			return Err(FileError::ArchiveEmptyError);
		}

		let images = sorted_image_entries(&archive);

		let mut content_types = HashMap::new();
		let mut pages_found = 0;

		for (name, content_type) in images {
			if pages.contains(&(pages_found + 1)) {
				trace!(?name, ?content_type, "found a targeted zip entry");
				content_types.insert(pages_found + 1, content_type);
				pages_found += 1;
			}

			// If we've found all the pages we need, we can stop
			if pages_found == pages.len() as i32 {
				break;
			}
		}

		Ok(content_types)
	}

	fn analyze_page(
		path: &str,
		page: i32,
		_: &LongboxConfig,
	) -> Result<AnalyzedPage, FileError> {
		let zip_file = File::open(path)?;
		let mut archive = zip::ZipArchive::new(&zip_file)?;

		if archive.is_empty() {
			error!(path, "Empty zip file");
			return Err(FileError::ArchiveEmptyError);
		}

		let images = sorted_image_entries(&archive);
		let Some((name, content_type)) = image_entry_for_page(&images, page).cloned()
		else {
			error!(page, path, "Failed to find valid image in zip file");
			return Err(FileError::NoImageError);
		};

		trace!(
			?name,
			page,
			?content_type,
			"Found targeted zip entry for analysis"
		);

		let file = archive.by_name(&name)?;

		// imagesize only needs the first few KB to read dimensions from headers, taking
		// extra as a precaution. 64kb should be plenty.
		const MAX_HEADER_BYTES: usize = 64 * 1024;
		let mut buf = Vec::with_capacity(MAX_HEADER_BYTES);
		file.take(MAX_HEADER_BYTES as u64).read_to_end(&mut buf)?;

		let size = imagesize::blob_size(&buf).map_err(|e| {
			FileError::UnknownError(format!("Failed to read image dimensions: {e}"))
		})?;

		Ok(AnalyzedPage {
			width: size.width as u32,
			height: size.height as u32,
			content_type,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::filesystem::media::tests::{
		get_nested_macos_compressed_cbz_path, get_test_cbz_path,
		get_test_complex_zip_path, get_test_zip_path,
	};

	#[test]
	fn test_process() {
		let path = get_test_zip_path();
		let config = LongboxConfig::debug();

		let processed_file = ZipProcessor::process(
			&path,
			FileProcessorOptions {
				convert_rar_to_zip: false,
				delete_conversion_source: false,
				..Default::default()
			},
			&config,
		);
		assert!(processed_file.is_ok());
	}

	#[test]
	fn test_process_cbz() {
		let path = get_test_cbz_path();
		let config = LongboxConfig::debug();

		let processed_file = ZipProcessor::process(
			&path,
			FileProcessorOptions {
				convert_rar_to_zip: false,
				delete_conversion_source: false,
				..Default::default()
			},
			&config,
		);
		assert!(processed_file.is_ok());
	}

	#[test]
	fn test_process_nested_cbz() {
		let path = get_nested_macos_compressed_cbz_path();
		let config = LongboxConfig::debug();

		let processed_file = ZipProcessor::process(
			&path,
			FileProcessorOptions {
				convert_rar_to_zip: false,
				delete_conversion_source: false,
				..Default::default()
			},
			&config,
		);
		assert!(processed_file.is_ok());
		assert_eq!(processed_file.unwrap().pages, 3);
	}

	#[test]
	fn test_get_page_cbz() {
		// Note: This doesn't work with the other test book, because it has no pages.
		let path = get_test_cbz_path();
		let config = LongboxConfig::debug();

		let page = ZipProcessor::get_page(&path, 1, &config);
		assert!(page.is_ok());
	}

	#[test]
	fn test_get_page_nested_cbz() {
		let path = get_nested_macos_compressed_cbz_path();

		let (content_type, buf) =
			ZipProcessor::get_page(&path, 1, &LongboxConfig::debug())
				.expect("Failed to get page");
		assert_eq!(content_type.mime_type(), "image/jpeg");
		// Note: this is known and expected to be 96623 bytes.
		assert_eq!(buf.len(), 96623);
	}

	#[test]
	fn test_get_page_content_types() {
		let path = get_test_zip_path();

		let content_types = ZipProcessor::get_page_content_types(&path, vec![1]);
		assert!(content_types.is_ok());
	}

	#[test]
	fn test_get_page_content_types_cbz() {
		let path = get_test_cbz_path();

		let content_types =
			ZipProcessor::get_page_content_types(&path, vec![1, 2, 3, 4, 5]);
		assert!(content_types.is_ok());
	}

	#[test]
	fn test_get_page_content_types_nested_cbz() {
		let path = get_nested_macos_compressed_cbz_path();

		let content_types = ZipProcessor::get_page_content_types(&path, vec![1, 2, 3])
			.expect("Failed to get page content types");
		assert_eq!(content_types.len(), 3);
		assert!(content_types
			.values()
			.all(|ct| ct.mime_type() == "image/jpeg"));
	}

	#[test]
	fn test_zip_with_complex_file_tree() {
		let path = get_test_complex_zip_path();

		let config = LongboxConfig::debug();
		let processed_file = ZipProcessor::process(
			&path,
			FileProcessorOptions {
				process_metadata: true,
				..Default::default()
			},
			&config,
		)
		.expect("Failed to process ZIP file");

		// See https://github.com/stumpapp/stump/issues/641
		assert!(processed_file.metadata.is_some());
	}

	#[test]
	fn test_analyze_page() {
		let path = get_test_cbz_path();
		let config = LongboxConfig::debug();

		let analyzed_page = ZipProcessor::analyze_page(&path, 1, &config)
			.expect("Failed to analyze page");
		assert_eq!(analyzed_page.width, 480);
		assert_eq!(analyzed_page.height, 726);
		assert_eq!(analyzed_page.content_type.mime_type(), "image/jpeg");
	}

	/// Write a zip with the given entries. A name ending in `/` is added as a directory entry.
	/// The [`tempfile::TempDir`] must be kept alive by the caller.
	fn build_zip(entries: &[(&str, &[u8])]) -> (tempfile::TempDir, String) {
		use std::io::Write;

		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let zip_path = tempdir.path().join("book.cbz");
		let file = File::create(&zip_path).expect("Failed to create zip file");

		let mut writer = zip::ZipWriter::new(file);
		let options = zip::write::SimpleFileOptions::default()
			.compression_method(zip::CompressionMethod::Stored);

		for (name, contents) in entries {
			if let Some(dir) = name.strip_suffix('/') {
				writer
					.add_directory(dir, options)
					.expect("Failed to add directory entry");
			} else {
				writer
					.start_file(*name, options)
					.expect("Failed to start zip entry");
				writer
					.write_all(contents)
					.expect("Failed to write zip entry");
			}
		}
		writer.finish().expect("Failed to finalize zip file");

		(tempdir, zip_path.to_string_lossy().to_string())
	}

	/// A mixed archive: directory entries, macOS resource forks, dotfiles, non-image files, and
	/// image names which only sort correctly under alphanumeric (not lexicographic) ordering.
	fn mixed_archive() -> (tempfile::TempDir, String) {
		build_zip(&[
			("__MACOSX/", b""),
			("__MACOSX/._page1.jpg", b"macos-resource-fork"),
			("book/", b""),
			("book/.hidden.jpg", b"dotfile"),
			("book/ComicInfo.xml", b"<ComicInfo/>"),
			("book/notes.txt", b"notes"),
			("book/page10.jpg", b"ten"),
			("book/page2.png", b"two"),
			("book/page1.jpg", b"one"),
		])
	}

	/// The pre-optimization implementation of [`ZipProcessor::get_page`], kept as a test oracle.
	/// It opens *every* entry in turn -- the O(page) header parsing we removed -- so any
	/// behavioural drift in the fast path shows up as a mismatch here.
	fn get_page_by_walking_every_entry(
		path: &str,
		page: i32,
	) -> Option<(ContentType, Vec<u8>)> {
		let zip_file = File::open(path).expect("Failed to open zip file");
		let mut archive =
			zip::ZipArchive::new(&zip_file).expect("Failed to read zip archive");
		let file_names_archive = archive.clone();

		let mut file_names = file_names_archive.file_names().collect::<Vec<_>>();
		sort_file_names(&mut file_names);

		let mut images_seen = 0;
		for name in file_names {
			let mut file = archive.by_name(name).expect("Failed to open zip entry");

			if file.is_dir() {
				continue;
			}

			let path_buf = file.enclosed_name().unwrap_or_else(|| PathBuf::from(name));
			let entry = path_buf.as_path();

			if entry.is_hidden_file() {
				continue;
			}

			let content_type = entry.naive_content_type();

			if images_seen + 1 == page && content_type.is_image() {
				let mut contents = Vec::new();
				file.read_to_end(&mut contents)
					.expect("Failed to read entry");
				return Some((content_type, contents));
			} else if content_type.is_image() {
				images_seen += 1;
			}
		}

		None
	}

	#[test]
	fn test_is_dir_entry_matches_zip_semantics() {
		assert!(is_dir_entry("book/"));
		assert!(is_dir_entry("book\\"));
		assert!(!is_dir_entry("book/page1.jpg"));
		assert!(!is_dir_entry(""));
	}

	#[test]
	fn test_enclosed_name_rejects_traversal() {
		// Zip entry names are attacker-controlled; these must not resolve to a usable path.
		assert_eq!(enclosed_name("../../etc/passwd"), None);
		assert_eq!(enclosed_name("book/../../secret.jpg"), None);
		assert_eq!(enclosed_name("/absolute/page.jpg"), None);
		assert_eq!(enclosed_name("book/\0page.jpg"), None);

		assert_eq!(
			enclosed_name("book/page1.jpg"),
			Some(PathBuf::from("book/page1.jpg"))
		);
		// Climbing back down to (but not above) the root is fine, as in the zip crate.
		assert_eq!(
			enclosed_name("book/../page1.jpg"),
			Some(PathBuf::from("book/../page1.jpg"))
		);
	}

	#[test]
	fn test_entry_path_falls_back_to_the_raw_name() {
		// Matches the previous `enclosed_name().unwrap_or_else(|| PathBuf::from(name))`.
		assert_eq!(entry_path("../evil.jpg"), PathBuf::from("../evil.jpg"));
		assert_eq!(
			entry_path("book/page1.jpg"),
			PathBuf::from("book/page1.jpg")
		);
	}

	#[test]
	fn test_sorted_image_entries_filters_and_orders() {
		let (_tempdir, path) = mixed_archive();
		let zip_file = File::open(&path).unwrap();
		let archive = zip::ZipArchive::new(&zip_file).unwrap();

		let entries = sorted_image_entries(&archive);
		let names = entries
			.iter()
			.map(|(name, _)| name.as_str())
			.collect::<Vec<_>>();

		assert_eq!(
			names,
			// page10 sorts *after* page2: alphanumeric ordering, not lexicographic. Directory
			// entries, __MACOSX forks, dotfiles and non-images are all dropped.
			vec!["book/page1.jpg", "book/page2.png", "book/page10.jpg"]
		);
		assert_eq!(entries[0].1.mime_type(), "image/jpeg");
		assert_eq!(entries[1].1.mime_type(), "image/png");
	}

	#[test]
	fn test_get_page_selects_the_right_entry() {
		let (_tempdir, path) = mixed_archive();
		let config = LongboxConfig::debug();

		for (page, expected_bytes, expected_mime) in [
			(1, &b"one"[..], "image/jpeg"),
			(2, &b"two"[..], "image/png"),
			(3, &b"ten"[..], "image/jpeg"),
		] {
			let (content_type, bytes) = ZipProcessor::get_page(&path, page, &config)
				.unwrap_or_else(|e| panic!("Failed to get page {page}: {e}"));
			assert_eq!(content_type.mime_type(), expected_mime, "page {page}");
			assert_eq!(bytes, expected_bytes, "page {page}");
		}
	}

	#[test]
	fn test_get_page_out_of_range_is_no_image_error() {
		let (_tempdir, path) = mixed_archive();
		let config = LongboxConfig::debug();

		for page in [-1, 0, 4, i32::MAX] {
			assert!(
				matches!(
					ZipProcessor::get_page(&path, page, &config),
					Err(FileError::NoImageError)
				),
				"page {page} should not resolve"
			);
		}
	}

	#[test]
	fn test_empty_archive_errors() {
		let (_tempdir, path) = build_zip(&[]);
		let config = LongboxConfig::debug();

		assert!(matches!(
			ZipProcessor::get_page(&path, 1, &config),
			Err(FileError::ArchiveEmptyError)
		));
		assert!(matches!(
			ZipProcessor::get_page_count(&path, &config),
			Err(FileError::ArchiveEmptyError)
		));
		assert!(matches!(
			ZipProcessor::get_page_content_types(&path, vec![1]),
			Err(FileError::ArchiveEmptyError)
		));
		assert!(matches!(
			ZipProcessor::analyze_page(&path, 1, &config),
			Err(FileError::ArchiveEmptyError)
		));
	}

	#[test]
	fn test_get_page_count_ignores_non_pages() {
		let (_tempdir, path) = mixed_archive();
		let config = LongboxConfig::debug();

		assert_eq!(ZipProcessor::get_page_count(&path, &config).unwrap(), 3);
	}

	#[test]
	fn test_get_page_content_types_uses_page_order() {
		let (_tempdir, path) = mixed_archive();

		let content_types = ZipProcessor::get_page_content_types(&path, vec![1, 2, 3])
			.expect("Failed to get page content types");

		assert_eq!(content_types.len(), 3);
		assert_eq!(content_types[&1].mime_type(), "image/jpeg");
		assert_eq!(content_types[&2].mime_type(), "image/png");
		assert_eq!(content_types[&3].mime_type(), "image/jpeg");
	}

	/// The whole point of the rewrite: page N must still be the same bytes the old, entry-by-entry
	/// walk produced -- for the first page, the last page, and every out-of-range case.
	#[test]
	fn test_get_page_matches_the_previous_implementation() {
		let config = LongboxConfig::debug();
		let (_tempdir, mixed) = mixed_archive();

		for path in [
			get_test_cbz_path(),
			get_nested_macos_compressed_cbz_path(),
			get_test_complex_zip_path(),
			mixed,
		] {
			let count = ZipProcessor::get_page_count(&path, &config)
				.expect("Failed to count pages");

			for page in [-1, 0, 1, 2, 3, count / 2, count - 1, count, count + 1] {
				let expected = get_page_by_walking_every_entry(&path, page);
				let actual = ZipProcessor::get_page(&path, page, &config).ok();

				assert_eq!(
					actual.is_some(),
					expected.is_some(),
					"presence mismatch for page {page} of {path}"
				);

				if let (Some(actual), Some(expected)) = (actual, expected) {
					assert_eq!(
						actual.0, expected.0,
						"content type mismatch for page {page} of {path}"
					);
					assert_eq!(
						actual.1, expected.1,
						"bytes mismatch for page {page} of {path}"
					);
				}
			}
		}
	}

	#[test]
	fn test_get_page_count_matches_the_previous_implementation() {
		let config = LongboxConfig::debug();

		for (path, expected) in [
			(get_test_cbz_path(), 36),
			(get_nested_macos_compressed_cbz_path(), 3),
			(get_test_complex_zip_path(), 0),
			(get_test_zip_path(), 0),
		] {
			assert_eq!(
				ZipProcessor::get_page_count(&path, &config).unwrap(),
				expected,
				"page count mismatch for {path}"
			);
		}
	}
}
