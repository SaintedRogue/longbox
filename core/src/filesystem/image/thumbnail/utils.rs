use std::path::{Path, PathBuf};

use models::shared::image_processor_options::{Dimension, ScaledDimensionResize};
use tokio::fs;
use tracing::{error, trace};

use crate::{
	config::LongboxConfig,
	filesystem::{
		image::{ImageProcessor, WebpProcessor},
		FileError,
	},
};

/// The widths a client may request as `?width=` thumbnail variants. A whitelist,
/// not a free parameter, so cache growth is bounded at a handful of files per
/// entity and a client can never mint unbounded variants.
pub const THUMBNAIL_VARIANT_WIDTHS: [u32; 4] = [160, 320, 480, 640];

pub fn is_variant_width(width: u32) -> bool {
	THUMBNAIL_VARIANT_WIDTHS.contains(&width)
}

fn variant_path(thumbnails_dir: &Path, entity_id: &str, width: u32) -> PathBuf {
	thumbnails_dir.join(format!("{entity_id}@{width}.webp"))
}

/// Serve (or lazily create) a downscaled WebP variant of an entity's base
/// thumbnail bytes. Returns `None` whenever the caller should serve the base
/// instead: non-whitelisted width, base already at or below the requested width
/// (downscale-only), or any generation error — a variant must never fail a
/// request the base could have served.
pub async fn thumbnail_variant(
	thumbnails_dir: &Path,
	entity_id: &str,
	width: u32,
	base_bytes: &[u8],
) -> Option<Vec<u8>> {
	if !is_variant_width(width) {
		return None;
	}

	let path = variant_path(thumbnails_dir, entity_id, width);
	if let Ok(bytes) = fs::read(&path).await {
		return Some(bytes);
	}

	// Downscale-only: a 640 request against a 512-wide base serves the base.
	// `imagesize` reads dimensions from the header without decoding the image.
	match imagesize::blob_size(base_bytes) {
		Ok(size) if (size.width as u32) > width => {},
		Ok(_) => return None,
		Err(error) => {
			tracing::warn!(?error, entity_id, "Could not size thumbnail for variant");
			return None;
		},
	}

	let base = base_bytes.to_vec();
	let resized = tokio::task::spawn_blocking(move || {
		WebpProcessor::resize_scaled(
			&base,
			ScaledDimensionResize {
				dimension: Dimension::Width,
				size: width,
			},
		)
	})
	.await;
	let bytes = match resized {
		Ok(Ok(bytes)) => bytes,
		Ok(Err(error)) => {
			tracing::warn!(?error, entity_id, width, "Thumbnail variant resize failed");
			return None;
		},
		Err(error) => {
			tracing::warn!(?error, entity_id, width, "Thumbnail variant task failed");
			return None;
		},
	};

	if let Err(error) = fs::write(&path, &bytes).await {
		tracing::warn!(?error, ?path, "Failed to persist thumbnail variant");
	}
	Some(bytes)
}

/// Remove every `{entity_id}@{width}.webp` variant. Call whenever the base
/// thumbnail is (re)written or removed, so a stale-sized variant can't outlive
/// the image it was derived from. Best-effort; the widths are a closed set so
/// no directory scan is needed.
pub async fn remove_thumbnail_variants(thumbnails_dir: &Path, entity_id: &str) {
	for width in THUMBNAIL_VARIANT_WIDTHS {
		let _ = fs::remove_file(variant_path(thumbnails_dir, entity_id, width)).await;
	}
}

pub async fn place_thumbnail(
	id: &str,
	ext: &str,
	bytes: &[u8],
	config: &LongboxConfig,
) -> Result<PathBuf, FileError> {
	let thumbnail_path = config.get_thumbnails_dir().join(format!("{id}.{ext}"));
	fs::write(&thumbnail_path, bytes).await?;
	Ok(thumbnail_path)
}

pub const THUMBNAIL_LOG_FREQUENCY: usize = 500;

/// Deletes thumbnails and returns the number deleted if successful, returns
/// [`FileError`] otherwise.
pub async fn remove_thumbnails(
	id_list: &[String],
	thumbnails_dir: &Path,
) -> Result<u64, FileError> {
	let mut read_dir = tokio::fs::read_dir(thumbnails_dir).await?;

	// Asynchronously collect thumbnails
	let mut found_thumbnails = Vec::with_capacity(id_list.len());
	while let Some(entry) = read_dir.next_entry().await? {
		let path = entry.path();
		if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
			if id_list.iter().any(|id| filename.starts_with(id)) {
				found_thumbnails.push(path);
			}
		}
	}

	let found_thumbnails_count = found_thumbnails.len();
	tracing::debug!(found_thumbnails_count, "Found thumbnails to remove");

	let mut deleted_thumbnails_count = 0;

	for (idx, path) in found_thumbnails.iter().enumerate() {
		if idx % THUMBNAIL_LOG_FREQUENCY == 0 {
			trace!("Processed {} thumbnails for removal.", idx + 1);
		}

		match tokio::fs::remove_file(path).await {
			Ok(_) => deleted_thumbnails_count += 1,
			Err(e) => {
				error!(error = ?e, ?path, "Error deleting thumbnail!");
				return Err(e.into());
			},
		};
	}

	Ok(deleted_thumbnails_count)
}

pub fn scale_width_dimension(w: f32, h: f32, target_height: f32) -> (u32, u32) {
	let scale = target_height / h;
	((w * scale).round() as u32, (h * scale).round() as u32)
}

pub fn scale_height_dimension(w: f32, h: f32, target_width: f32) -> (u32, u32) {
	let scale = target_width / w;
	((w * scale).round() as u32, (h * scale).round() as u32)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A real encodable image: 512x800 PNG, solid color.
	fn base_png() -> Vec<u8> {
		let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
			512,
			800,
			image::Rgb([120, 40, 200]),
		));
		let mut bytes = std::io::Cursor::new(Vec::new());
		img.write_to(&mut bytes, image::ImageFormat::Png)
			.expect("png encodes");
		bytes.into_inner()
	}

	#[tokio::test]
	async fn variant_is_created_then_served_from_disk() {
		let dir = tempfile::tempdir().expect("tempdir");
		let base = base_png();

		let first = thumbnail_variant(dir.path(), "book-1", 160, &base)
			.await
			.expect("variant generates");
		let on_disk = dir.path().join("book-1@160.webp");
		assert!(on_disk.exists(), "variant persisted beside the base");
		assert_eq!(
			imagesize::blob_size(&first).expect("sized").width,
			160,
			"variant is resized to the requested width"
		);

		// Prove the second call is a cache read: plant a sentinel in the file.
		tokio::fs::write(&on_disk, b"sentinel")
			.await
			.expect("write");
		let second = thumbnail_variant(dir.path(), "book-1", 160, &base)
			.await
			.expect("cache hit");
		assert_eq!(second, b"sentinel");
	}

	#[tokio::test]
	async fn variants_never_upscale_and_reject_unlisted_widths() {
		let dir = tempfile::tempdir().expect("tempdir");
		let base = base_png(); // 512 wide

		assert!(
			thumbnail_variant(dir.path(), "book-1", 640, &base)
				.await
				.is_none(),
			"a request wider than the base serves the base"
		);
		assert!(
			thumbnail_variant(dir.path(), "book-1", 333, &base)
				.await
				.is_none(),
			"non-whitelisted widths are ignored"
		);
		assert!(
			thumbnail_variant(dir.path(), "book-1", 160, b"not an image")
				.await
				.is_none(),
			"garbage bytes degrade to serving the base, never an error"
		);
	}

	#[tokio::test]
	async fn removing_variants_sweeps_every_width() {
		let dir = tempfile::tempdir().expect("tempdir");
		let base = base_png();
		for width in [160u32, 320, 480] {
			thumbnail_variant(dir.path(), "book-1", width, &base)
				.await
				.expect("variant generates");
		}

		remove_thumbnail_variants(dir.path(), "book-1").await;

		for width in THUMBNAIL_VARIANT_WIDTHS {
			assert!(
				!dir.path().join(format!("book-1@{width}.webp")).exists(),
				"variant {width} must be swept"
			);
		}
	}
}
