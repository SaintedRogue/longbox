mod error;
mod generic;
mod process;
mod thumbnail;
mod webp;

pub use self::webp::WebpProcessor;
pub use error::ProcessorError;
pub use generic::GenericImageProcessor;
use image::ImageFormat;
use models::shared::image_processor_options::{
	Dimension, ScaledDimensionResize, SupportedImageFormat,
};
pub use process::{ImageProcessor, ImageProcessorOptionsExt};
pub use thumbnail::*;
use tokio::{
	sync::{oneshot, Semaphore},
	task::spawn_blocking,
};

/// Caps how many reader pages are decoded for previews at once.
///
/// The reader's preview strip asks for a dozen or more previews in a burst, and each one holds a
/// fully decoded page in memory while it works -- a 2000x3000 page is ~24MB decoded, so an
/// unbounded burst is hundreds of megabytes of transient allocation on hardware Longbox is
/// routinely self-hosted on. Queueing past this point costs a preview a few tens of milliseconds;
/// not queueing costs the whole process its memory headroom.
static PREVIEW_RENDERS: Semaphore = Semaphore::const_new(4);

/// Downscale a reader page to `width`, encoded as WebP.
///
/// Returns `None` whenever the caller should serve the source page unchanged: a width outside
/// [`THUMBNAIL_VARIANT_WIDTHS`], a page already at or below `width` (downscale only), or any
/// sizing/decode/encode failure. A preview must never fail a request the full page could have
/// served.
///
/// Unlike [`thumbnail_variant`] this persists nothing. A page preview is addressed by (book file,
/// page, width) and is served under the `SourcePage` cache policy, so the client keeps it for a day
/// and revalidates for a year. A server-side copy would buy a second cache layer at the price of an
/// invalidation story for a file Longbox does not own and does not rewrite.
pub async fn page_preview(source: &[u8], width: u32) -> Option<Vec<u8>> {
	if !is_variant_width(width) {
		return None;
	}

	// `imagesize` reads the dimensions out of the image header, so a page that is already small
	// enough is rejected without ever paying for a decode.
	match imagesize::blob_size(source) {
		Ok(size) if (size.width as u32) > width => {},
		Ok(_) => return None,
		Err(error) => {
			tracing::warn!(?error, "Could not size page for preview");
			return None;
		},
	}

	// Held across the decode, not just the copy: the permit is what bounds peak memory.
	let Ok(_permit) = PREVIEW_RENDERS.acquire().await else {
		tracing::warn!("Page preview semaphore closed");
		return None;
	};

	let source = source.to_vec();
	let resized = spawn_blocking(move || {
		WebpProcessor::resize_scaled(
			&source,
			ScaledDimensionResize {
				dimension: Dimension::Width,
				size: width,
			},
		)
	})
	.await;

	match resized {
		Ok(Ok(bytes)) => Some(bytes),
		Ok(Err(error)) => {
			tracing::warn!(?error, width, "Page preview resize failed");
			None
		},
		Err(error) => {
			tracing::warn!(?error, width, "Page preview task failed");
			None
		},
	}
}

pub fn into_image_format(format: SupportedImageFormat) -> ImageFormat {
	match format {
		SupportedImageFormat::Jpeg => ImageFormat::Jpeg,
		SupportedImageFormat::Png => ImageFormat::Png,
		SupportedImageFormat::Webp => ImageFormat::WebP,
	}
}

fn _resize_image(
	buf: &[u8],
	dimension: ScaledDimensionResize,
) -> Result<Vec<u8>, ProcessorError> {
	match image::guess_format(buf)? {
		ImageFormat::WebP => Ok(WebpProcessor::resize_scaled(buf, dimension)?),
		ImageFormat::Jpeg | ImageFormat::Png => {
			Ok(GenericImageProcessor::resize_scaled(buf, dimension)?)
		},
		_ => Err(ProcessorError::UnsupportedImageFormat),
	}
}

pub async fn resize_image(
	buf: Vec<u8>,
	dimension: ScaledDimensionResize,
) -> Result<Vec<u8>, ProcessorError> {
	let (tx, rx) = oneshot::channel();

	let handle = spawn_blocking({
		move || {
			let send_result = tx.send(_resize_image(&buf, dimension));
			tracing::trace!(
				is_err = send_result.is_err(),
				"Sending result of resize_image"
			);
		}
	});

	let resized_image = if let Ok(recv) = rx.await {
		recv?
	} else {
		handle
			.await
			.map_err(|e| ProcessorError::UnknownError(e.to_string()))?;
		return Err(ProcessorError::UnknownError(
			"Failed to receive resized image".to_string(),
		));
	};

	Ok(resized_image)
}

#[cfg(test)]
mod tests {
	use std::path::PathBuf;

	pub fn get_test_webp_path() -> String {
		PathBuf::from(env!("CARGO_MANIFEST_DIR"))
			.join("integration-tests/data/example.webp")
			.to_string_lossy()
			.to_string()
	}

	pub fn get_test_jpg_path() -> String {
		PathBuf::from(env!("CARGO_MANIFEST_DIR"))
			.join("integration-tests/data/example.jpeg")
			.to_string_lossy()
			.to_string()
	}

	pub fn get_test_png_path() -> String {
		PathBuf::from(env!("CARGO_MANIFEST_DIR"))
			.join("integration-tests/data/example.png")
			.to_string_lossy()
			.to_string()
	}

	// pub fn get_test_avif_path() -> String {
	// 	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
	// 		.join("integration-tests/data/example.avif")
	// 		.to_string_lossy()
	// 		.to_string()
	// }

	// TODO(339): Avif + Jxl support
	// pub fn get_test_jxl_path() -> String {
	// 	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
	// 		.join("integration-tests/data/example.jxl")

	mod page_preview {
		use super::*;
		use crate::filesystem::image::page_preview;

		/// The fixtures are all 550x368, so 320 downscales and 640 does not.
		const FIXTURE_WIDTH: u32 = 550;

		#[tokio::test]
		async fn downscales_to_a_whitelisted_width() {
			let source = std::fs::read(get_test_jpg_path()).unwrap();

			let preview = page_preview(&source, 320)
				.await
				.expect("a 550px-wide page must downscale to 320");

			let size = imagesize::blob_size(&preview).unwrap();
			assert_eq!(size.width, 320);
			assert!(
				preview.len() < source.len(),
				"a preview that is not smaller than the page defeats the point"
			);
			assert!(
				image::load_from_memory_with_format(&preview, image::ImageFormat::WebP)
					.is_ok(),
				"previews are served as webp"
			);
		}

		#[tokio::test]
		async fn resizes_webp_and_png_pages_too() {
			for path in [get_test_webp_path(), get_test_png_path()] {
				let source = std::fs::read(&path).unwrap();
				let preview = page_preview(&source, 160)
					.await
					.unwrap_or_else(|| panic!("{path} must downscale"));
				assert_eq!(imagesize::blob_size(&preview).unwrap().width, 160);
			}
		}

		/// A width outside the whitelist must fall through to the full page rather than letting a
		/// client mint an unbounded set of distinct renders of the same page.
		#[tokio::test]
		async fn rejects_a_width_outside_the_whitelist() {
			let source = std::fs::read(get_test_jpg_path()).unwrap();
			assert!(page_preview(&source, 321).await.is_none());
			assert!(page_preview(&source, 0).await.is_none());
		}

		/// Downscale only: re-encoding a page *up* to a larger width costs CPU and bytes to produce
		/// something worse than the original.
		#[tokio::test]
		async fn rejects_a_page_already_small_enough() {
			let source = std::fs::read(get_test_jpg_path()).unwrap();
			assert_eq!(
				imagesize::blob_size(&source).unwrap().width as u32,
				FIXTURE_WIDTH,
				"the premise of this test is that the fixture is narrower than 640"
			);
			assert!(page_preview(&source, 640).await.is_none());
		}

		/// A preview must never fail a request the full page could have served.
		#[tokio::test]
		async fn falls_through_on_undecodable_bytes() {
			assert!(page_preview(b"not an image at all", 320).await.is_none());
		}
	}
}
