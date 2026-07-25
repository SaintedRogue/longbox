use std::io;

use thiserror::Error;
use unrar::error::UnrarError;
use zip::result::ZipError;

use crate::error::CoreError;

#[derive(Error, Debug)]
pub enum FileError {
	#[error("Error occurred while opening file: {0}")]
	FileIoError(#[from] io::Error),
	#[error("A zip error occurred: {0}")]
	ZipFileError(#[from] ZipError),
	#[error("Archive contains no files")]
	ArchiveEmptyError,
	#[error("Failed to deserialize file: {0}")]
	DeserializeError(#[from] serde_json::Error),
	#[error("Unable to open .epub file: {0}")]
	EpubOpenError(String),
	#[error("Error while attempting to read .epub file: {0}")]
	EpubReadError(String),
	#[error("Could not find an image")]
	NoImageError,
	#[error("{0}")]
	PdfError(#[from] pdf::error::PdfError),
	#[error("{0}")]
	PdfRendererError(#[from] pdfium_render::prelude::PdfiumError),
	#[error("Longbox is not properly configured to render PDFs")]
	PdfConfigurationError,
	#[error("Failed to process PDF file: {0}")]
	PdfProcessingError(String),
	#[error("{0}")]
	RarError(#[from] UnrarError),
	#[error("Failed to open rar archive: {0}")]
	RarNulError(#[from] unrar::error::NulError),
	#[error("Could not open rar file")]
	RarOpenError,
	#[error("Error extracting RAR file: {0}")]
	RarExtractError(String),
	#[error("Error reading RAR file")]
	RarReadError,
	#[error("Error reading RAR byte content")]
	RarByteReadError(#[from] std::str::Utf8Error),
	#[error("Unsupported file type: {0}")]
	UnsupportedFileType(String),
	#[error("{0}")]
	ImageIoError(#[from] image::ImageError),
	#[error("Failed to encode image to webp: {0}")]
	WebpEncodeError(String),
	#[error("Failed to read directory")]
	DirectoryReadError,
	#[error("Incorrect image processor for requested format")]
	IncorrectProcessorError,
	#[error("An unknown error occurred: {0}")]
	UnknownError(String),
}

impl FileError {
	/// Whether this error was caused by a file which does not exist on disk.
	///
	/// The HTTP layer uses this to answer with a 404 instead of a 500: a book whose source file
	/// was moved or deleted since the last scan is a missing resource, not a server fault. Only
	/// variants which genuinely wrap an [`io::Error`] are considered.
	pub fn is_not_found(&self) -> bool {
		let io_error = match self {
			FileError::FileIoError(error) => Some(error),
			FileError::ZipFileError(ZipError::Io(error)) => Some(error),
			FileError::ImageIoError(image::ImageError::IoError(error)) => Some(error),
			_ => None,
		};

		io_error.is_some_and(|error| error.kind() == io::ErrorKind::NotFound)
	}
}

impl From<FileError> for CoreError {
	fn from(error: FileError) -> Self {
		match error {
			FileError::FileIoError(err) => CoreError::IoError(err),
			FileError::UnknownError(err) => CoreError::Unknown(err),
			_ => CoreError::InternalError(error.to_string()),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn not_found() -> io::Error {
		io::Error::new(io::ErrorKind::NotFound, "No such file or directory")
	}

	#[test]
	fn missing_source_file_is_not_found() {
		assert!(FileError::FileIoError(not_found()).is_not_found());
		assert!(FileError::ZipFileError(ZipError::Io(not_found())).is_not_found());
		assert!(
			FileError::ImageIoError(image::ImageError::IoError(not_found()))
				.is_not_found()
		);
	}

	#[test]
	fn other_io_errors_are_not_not_found() {
		let denied = || io::Error::new(io::ErrorKind::PermissionDenied, "nope");

		assert!(!FileError::FileIoError(denied()).is_not_found());
		assert!(!FileError::ZipFileError(ZipError::Io(denied())).is_not_found());
		assert!(
			!FileError::ImageIoError(image::ImageError::IoError(denied())).is_not_found()
		);
	}

	#[test]
	fn unrelated_errors_are_not_not_found() {
		// These are genuine internal errors and must keep mapping to a 500. In particular
		// `ZipError::FileNotFound` refers to an *entry* missing from an archive we opened fine,
		// which is a corrupt/unexpected book rather than a missing resource.
		assert!(!FileError::ArchiveEmptyError.is_not_found());
		assert!(!FileError::NoImageError.is_not_found());
		assert!(!FileError::DirectoryReadError.is_not_found());
		assert!(!FileError::ZipFileError(ZipError::FileNotFound).is_not_found());
		assert!(!FileError::ZipFileError(ZipError::InvalidArchive("bad")).is_not_found());
		assert!(!FileError::UnknownError("boom".to_string()).is_not_found());
		assert!(!FileError::EpubOpenError("boom".to_string()).is_not_found());
	}
}
