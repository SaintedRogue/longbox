use itertools::Itertools;
use models::shared::image_processor_options::SupportedImageFormat;
use std::{
	collections::HashMap,
	fs::File,
	path::{Path, PathBuf},
};
use tracing::{debug, error, trace, warn};
use unrar::{Archive, CursorBeforeHeader, List, OpenArchive, Process, UnrarResult};

use crate::{
	config::LongboxConfig,
	filesystem::{
		archive::create_zip_archive,
		content_type::ContentType,
		error::FileError,
		hash::{self, HASH_SAMPLE_COUNT, HASH_SAMPLE_SIZE},
		media::{
			process::{
				assert_conversion_is_readable, create_unpack_dir,
				dispose_of_conversion_source, AnalyzedPage, FileConverter, FileProcessor,
				FileProcessorOptions, ProcessedFile, ProcessedFileHashes,
			},
			utils::metadata_from_buf,
			zip::ZipProcessor,
			ProcessedMediaMetadata,
		},
		FileParts, PathUtils,
	},
};

/// A file processor for RAR files.
pub struct RarProcessor;

impl RarProcessor {
	fn init() {
		// See https://github.com/muja/unrar.rs/issues/44
		#[cfg(target_os = "linux")]
		{
			let locale =
				std::env::var("LIBC_LOCALE").unwrap_or_else(|_| "en_US.utf8".to_string());
			tracing::debug!(?locale, "Setting locale for unrar");

			let locale =
				std::ffi::CString::new(locale).expect("Failed to convert locale!");
			unsafe { libc::setlocale(libc::LC_ALL, locale.as_ptr()) };
		}
	}

	fn open_for_processing(
		path: &str,
	) -> UnrarResult<OpenArchive<Process, CursorBeforeHeader>> {
		Self::init();
		Archive::new(path).open_for_processing()
	}

	fn open_for_listing(
		path: &str,
	) -> UnrarResult<OpenArchive<List, CursorBeforeHeader>> {
		Self::init();
		Archive::new(path).open_for_listing()
	}
}

impl FileProcessor for RarProcessor {
	fn get_sample_size(path: &str) -> Result<u64, FileError> {
		let file = File::open(path)?;

		let file_size = file.metadata()?.len();
		let threshold = HASH_SAMPLE_SIZE * HASH_SAMPLE_COUNT;

		if file_size < threshold {
			return Ok(file_size);
		}

		let division = file_size / threshold;

		// if the file size is 4x the threshold, we'll take up to the threshold.
		if division > 4 {
			Ok(threshold)
		} else {
			Ok(file_size / 2)
		}
	}

	fn generate_longbox_hash(path: &str) -> Option<String> {
		let sample_result = RarProcessor::get_sample_size(path).ok();

		if let Some(sample) = sample_result {
			match hash::generate(path, sample) {
				Ok(digest) => Some(digest),
				Err(e) => {
					debug!(error = ?e, path, "Failed to digest RAR file");

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
			.then(|| RarProcessor::generate_longbox_hash(path))
			.flatten();
		// TODO(koreader): Do we want to hash RAR files?
		// let koreader_hash = generate_koreader_hashes
		// 	.then(|| generate_koreader_hash(path))
		// 	.transpose()?;

		Ok(ProcessedFileHashes {
			hash,
			koreader_hash: None,
		})
	}

	fn process_metadata(path: &str) -> Result<Option<ProcessedMediaMetadata>, FileError> {
		let mut archive = RarProcessor::open_for_processing(path)?;
		let mut metadata_buf = None;

		while let Ok(Some(header)) = archive.read_header() {
			let entry = header.entry();

			if entry.is_directory() {
				archive = header.skip()?;
				continue;
			}

			if entry.filename.is_hidden_file() {
				archive = header.skip()?;
				continue;
			}

			if entry.filename.as_os_str() == "ComicInfo.xml" {
				let (data, _) = header.read()?;
				metadata_buf = Some(data);
				break;
			} else {
				archive = header.skip()?;
			}
		}

		if let Some(buf) = metadata_buf {
			let content_str = std::str::from_utf8(&buf)?;
			Ok(metadata_from_buf(content_str))
		} else {
			Ok(None)
		}
	}

	fn process(
		path: &str,
		options: FileProcessorOptions,
		config: &LongboxConfig,
	) -> Result<ProcessedFile, FileError> {
		if options.convert_rar_to_zip {
			let zip_path_buf = RarProcessor::to_zip(
				path,
				options.delete_conversion_source,
				None,
				config,
			)?;
			let zip_path = zip_path_buf.to_str().ok_or_else(|| {
				FileError::UnknownError(
					"Converted RAR file failed to be discovered".to_string(),
				)
			})?;
			return ZipProcessor::process(zip_path, options, config);
		}

		let ProcessedFileHashes {
			hash,
			koreader_hash,
		} = RarProcessor::generate_hashes(path, options)?;

		let mut archive = RarProcessor::open_for_processing(path)?;
		let mut pages = 0;
		let mut metadata_buf = None;

		while let Ok(Some(header)) = archive.read_header() {
			let entry = header.entry();

			let Some(filename) = entry.filename.as_path().file_name() else {
				tracing::warn!(?entry.filename, "Failed to get filename from entry");
				archive = header.skip()?;
				continue;
			};

			if entry.is_directory() {
				archive = header.skip()?;
				continue;
			}

			if entry.filename.is_hidden_file() {
				archive = header.skip()?;
				continue;
			}

			if filename == "ComicInfo.xml" && options.process_metadata {
				let (data, rest) = header.read()?;
				metadata_buf = Some(data);
				archive = rest;
			} else {
				// If the entry is not an image then it cannot be a valid page
				if entry.filename.is_img() {
					pages += 1;
				}
				archive = header.skip()?;
			}
		}

		let metadata = if let Some(buf) = metadata_buf {
			let content_str = std::str::from_utf8(&buf)?;
			metadata_from_buf(content_str)
		} else {
			None
		};

		Ok(ProcessedFile {
			path: PathBuf::from(path),
			hash,
			koreader_hash,
			metadata,
			pages,
		})
	}

	fn get_page(
		file: &str,
		page: i32,
		_: &LongboxConfig,
	) -> Result<(ContentType, Vec<u8>), FileError> {
		let archive = RarProcessor::open_for_listing(file)?;

		let sorted_entries = archive
			.into_iter()
			.filter_map(Result::ok)
			.filter(|entry| entry.filename.is_img() && !entry.filename.is_hidden_file())
			.sorted_by(|a, b| alphanumeric_sort::compare_path(&a.filename, &b.filename))
			.collect::<Vec<_>>();

		let target_entry = sorted_entries
			.into_iter()
			.nth((page - 1) as usize)
			.ok_or(FileError::RarReadError)?;
		let FileParts { extension, .. } = target_entry.filename.as_path().file_parts();

		let mut bytes = None;
		let mut archive = RarProcessor::open_for_processing(file)?;
		while let Ok(Some(header)) = archive.read_header() {
			let is_target = header.entry().filename == target_entry.filename;
			if is_target {
				let (data, _) = header.read()?;
				bytes = Some(data);
				break;
			}

			// Otherwise, skip
			archive = header.skip()?;
		}

		let Some(bytes) = bytes else {
			return Err(FileError::NoImageError);
		};

		if bytes.len() < 5 {
			debug!(path = ?file, ?bytes, "File is too small to determine content type");
			return Err(FileError::NoImageError);
		}
		let mut magic_header = [0; 5];
		magic_header.copy_from_slice(&bytes[0..5]);
		let content_type =
			ContentType::from_bytes_with_fallback(&magic_header, &extension);

		Ok((content_type, bytes))
	}

	fn get_page_count(path: &str, _: &LongboxConfig) -> Result<i32, FileError> {
		let archive = RarProcessor::open_for_listing(path)?;

		let page_count = archive
			.into_iter()
			.filter_map(Result::ok)
			.filter(|entry| entry.filename.is_img() && !entry.filename.is_hidden_file())
			.count();

		Ok(page_count as i32)
	}

	fn get_page_content_types(
		path: &str,
		pages: Vec<i32>,
	) -> Result<HashMap<i32, ContentType>, FileError> {
		let archive = RarProcessor::open_for_listing(path)?;

		let sorted_entries = archive
			.into_iter()
			.filter_map(Result::ok)
			.filter(|entry| entry.filename.is_img())
			.sorted_by(|a, b| alphanumeric_sort::compare_path(&a.filename, &b.filename))
			.collect::<Vec<_>>();

		let mut content_types = HashMap::new();

		// `page` is the entry's position among real pages; `pages_found` counts matches. Sharing
		// one counter for both (the previous behaviour) meant the page cursor stalled on any
		// entry that wasn't requested, so a request not starting at page 1 -- e.g. the
		// `vec![1, current_page]` the OPDS v1.2 feed builds for a partially-read book -- returned
		// nothing and scanned every entry without ever breaking early.
		let mut page = 0;
		let mut pages_found = 0;
		for entry in sorted_entries {
			let path = entry.filename;

			if path.is_hidden_file() {
				trace!(path = ?path, "Skipping hidden file");
				continue;
			}

			let content_type = path.naive_content_type();
			if !content_type.is_image() {
				continue;
			}

			// Only real pages advance the cursor, so hidden and non-image entries can't shift
			// the numbering that `get_page` resolves against.
			page += 1;

			if pages.contains(&page) {
				trace!(?path, ?content_type, page, "found a targeted rar entry");
				content_types.insert(page, content_type);
				pages_found += 1;
			}

			// If we've found all the pages we need, we can stop
			if pages_found == pages.len() {
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
		let archive = RarProcessor::open_for_listing(path)?;

		let sorted_entries = archive
			.into_iter()
			.filter_map(Result::ok)
			.filter(|entry| entry.filename.is_img() && !entry.filename.is_hidden_file())
			.sorted_by(|a, b| alphanumeric_sort::compare_path(&a.filename, &b.filename))
			.collect::<Vec<_>>();

		if sorted_entries.is_empty() {
			return Err(FileError::NoImageError);
		}

		let target_entry = sorted_entries
			.into_iter()
			.nth((page - 1) as usize)
			.ok_or(FileError::NoImageError)?;

		let content_type = target_entry.filename.as_path().naive_content_type();

		let mut bytes = None;
		let mut archive = RarProcessor::open_for_processing(path)?;
		while let Ok(Some(header)) = archive.read_header() {
			let is_target = header.entry().filename == target_entry.filename;
			if is_target {
				let (data, _) = header.read()?;
				bytes = Some(data);
				break;
			}

			archive = header.skip()?;
		}

		let Some(bytes) = bytes else {
			return Err(FileError::NoImageError);
		};

		let size = imagesize::blob_size(&bytes).map_err(|e| {
			FileError::UnknownError(format!("Failed to read image dimensions: {e}"))
		})?;

		Ok(AnalyzedPage {
			width: size.width as u32,
			height: size.height as u32,
			content_type,
		})
	}
}

impl FileConverter for RarProcessor {
	fn to_zip(
		path: &str,
		delete_source: bool,
		_: Option<SupportedImageFormat>,
		config: &LongboxConfig,
	) -> Result<PathBuf, FileError> {
		debug!(path, "Converting RAR to ZIP");

		// TODO: remove these defaults and bubble up an error...
		let path_buf = PathBuf::from(path);
		let parent = path_buf.parent().unwrap_or_else(|| Path::new("/"));
		let FileParts {
			extension,
			file_stem,
			file_name,
		} = path_buf.as_path().file_parts();

		let cache_dir = config.get_cache_dir();
		let unpack_dir = create_unpack_dir(&cache_dir, &file_stem)?;
		let unpacked_path = unpack_dir.path();

		trace!(?unpacked_path, "Extracting RAR to disk");

		let mut archive = RarProcessor::open_for_processing(path)?;
		while let Ok(Some(header)) = archive.read_header() {
			archive = if header.entry().is_file() {
				// `extract_with_base` treats the argument as a *directory* and keeps each
				// entry's own relative path. `extract_to` treats it as the destination
				// *file*, so using it here wrote every page in the archive over the same
				// path — the unpack directory ended up a single file holding the last
				// page, and the conversion silently threw the book away.
				header.extract_with_base(unpacked_path)?
			} else {
				header.skip()?
			};
		}

		let zip_path = create_zip_archive(unpacked_path, &file_name, &extension, parent)?;

		// The unpacked pages are no longer needed; dropping the handle removes them, on
		// this path and on the error paths below alike.
		drop(unpack_dir);

		// Order matters: the source is the only remaining copy of the book until the
		// conversion is proven readable, so verify first and leave the original alone if
		// anything is wrong.
		if let Err(err) = assert_conversion_is_readable(&zip_path) {
			error!(error = ?err, path, ?zip_path, "Discarding an unusable RAR conversion");
			let _ = std::fs::remove_file(&zip_path);
			return Err(err);
		}

		if let Err(err) =
			dispose_of_conversion_source(Path::new(path), delete_source, config)
		{
			// The conversion is good and indexable; failing to tidy the source is worth
			// a loud log but not worth throwing the converted file away.
			warn!(error = ?err, path, "Failed to dispose of the converted RAR source");
		}

		Ok(zip_path)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::filesystem::media::tests::{
		get_test_complex_rar_path, get_test_rar_file_data, get_test_rar_path,
	};

	use std::fs;

	#[test]
	fn test_process() {
		// Create temporary directory and place a copy of our mock book.rar in it
		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let temp_rar_file_path = tempdir
			.path()
			.join("book.rar")
			.to_string_lossy()
			.to_string();
		fs::write(&temp_rar_file_path, get_test_rar_file_data())
			.expect("Failed to write temporary book.rar");
		let config = LongboxConfig::debug();

		// We can test deletion since it's a temporary file
		let processed_file = RarProcessor::process(
			&temp_rar_file_path,
			FileProcessorOptions {
				convert_rar_to_zip: true,
				delete_conversion_source: true,
				..Default::default()
			},
			&config,
		);

		// Assert that the operation succeeded
		assert!(processed_file.is_ok(), "{:?}", processed_file.err());
		// And that the original file was deleted
		assert!(!Path::new(&temp_rar_file_path).exists());
	}

	#[test]
	fn test_rar_to_zip() {
		// Create temporary directory and place a copy of our mock book.rar in it
		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let temp_rar_file_path = tempdir
			.path()
			.join("book.rar")
			.to_string_lossy()
			.to_string();
		fs::write(&temp_rar_file_path, get_test_rar_file_data())
			.expect("Failed to write temporary book.rar");
		let config = LongboxConfig::debug();

		// We have a temporary file, so we may as well test deletion also
		let zip_result = RarProcessor::to_zip(&temp_rar_file_path, true, None, &config);
		// Assert that operation succeeded
		assert!(zip_result.is_ok());
		// And that the original file was deleted
		assert!(!Path::new(&temp_rar_file_path).exists());
	}

	#[test]
	fn test_to_zip_keeps_every_page_under_its_own_name() {
		// The fixture holds many files. Extracting each of them *onto the same path*
		// leaves one file behind rather than a directory, and the conversion then
		// produced a zip with a single nameless entry — a "successful" conversion that
		// destroyed all but the last page. Assert on the entry names, because a
		// single-file fixture cannot tell the two behaviours apart.
		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let temp_rar_file_path = tempdir
			.path()
			.join("book-complex-tree.rar")
			.to_string_lossy()
			.to_string();
		fs::copy(get_test_complex_rar_path(), &temp_rar_file_path)
			.expect("Failed to copy the complex test rar");
		let config = LongboxConfig::debug();

		let zip_path = RarProcessor::to_zip(&temp_rar_file_path, false, None, &config)
			.expect("conversion should succeed");

		let mut archive = zip::ZipArchive::new(
			File::open(&zip_path).expect("converted zip is readable"),
		)
		.expect("converted file is a valid zip");

		assert!(
			archive.len() > 1,
			"expected every page to survive, found {} entries",
			archive.len()
		);
		for index in 0..archive.len() {
			let entry = archive.by_index(index).expect("entry is readable");
			assert!(
				!entry.name().trim_matches('/').is_empty(),
				"entry {index} has an empty name"
			);
		}
	}

	#[test]
	fn test_to_zip_moves_the_source_out_of_the_library_when_not_hard_deleting() {
		// The source must never be left in the library next to its conversion: the
		// scanner would index both. It must not go to the OS trash either, because for
		// a library on its own mount that trash lives *inside* the library root.
		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let temp_rar_file_path = tempdir
			.path()
			.join("book.rar")
			.to_string_lossy()
			.to_string();
		fs::write(&temp_rar_file_path, get_test_rar_file_data())
			.expect("Failed to write temporary book.rar");

		let config_dir = tempfile::tempdir().expect("Failed to create config directory");
		let config = LongboxConfig {
			config_dir: config_dir.path().to_string_lossy().to_string(),
			..LongboxConfig::debug()
		};

		RarProcessor::to_zip(&temp_rar_file_path, false, None, &config)
			.expect("conversion should succeed");

		assert!(
			!Path::new(&temp_rar_file_path).exists(),
			"source must not remain in the library"
		);
		assert!(
			config.get_conversion_backup_dir().join("book.rar").exists(),
			"source should be recoverable from the conversion backup directory"
		);
	}

	#[test]
	fn test_to_zip_hard_deletes_the_source_without_a_backup() {
		let tempdir = tempfile::tempdir().expect("Failed to create temporary directory");
		let temp_rar_file_path = tempdir
			.path()
			.join("book.rar")
			.to_string_lossy()
			.to_string();
		fs::write(&temp_rar_file_path, get_test_rar_file_data())
			.expect("Failed to write temporary book.rar");

		let config_dir = tempfile::tempdir().expect("Failed to create config directory");
		let config = LongboxConfig {
			config_dir: config_dir.path().to_string_lossy().to_string(),
			..LongboxConfig::debug()
		};

		RarProcessor::to_zip(&temp_rar_file_path, true, None, &config)
			.expect("conversion should succeed");

		assert!(!Path::new(&temp_rar_file_path).exists());
		assert!(
			!config.get_conversion_backup_dir().join("book.rar").exists(),
			"a hard delete should not keep a copy"
		);
	}

	#[test]
	fn test_get_page_content_types() {
		let path = get_test_rar_path();

		let content_types = RarProcessor::get_page_content_types(&path, vec![1]);
		assert!(content_types.is_ok());
	}

	#[test]
	fn test_rar_with_complex_file_tree() {
		let path = get_test_complex_rar_path();

		let config = LongboxConfig::debug();
		let processed_file = RarProcessor::process(
			&path,
			FileProcessorOptions {
				process_metadata: true,
				..Default::default()
			},
			&config,
		)
		.expect("Failed to process RAR file");

		// See https://github.com/stumpapp/stump/issues/641
		assert!(processed_file.metadata.is_some());
	}
}
