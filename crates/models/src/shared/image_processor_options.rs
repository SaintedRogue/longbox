use async_graphql::{Enum, InputObject, OneofObject, SimpleObject, Union};
use sea_orm::{prelude::Decimal, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Enum)]
pub enum Dimension {
	Height,
	Width,
}

/// A resize option which will resize the image while maintaining the aspect ratio.
/// The dimension *not* specified will be calculated based on the aspect ratio.
#[derive(
	Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, SimpleObject, InputObject,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "ScaledDimensionResizeInput")]
pub struct ScaledDimensionResize {
	/// The dimension to set with the given size, e.g. `Height` or `Width`.
	pub dimension: Dimension,
	/// The size (in pixels) to set the specified dimension to.
	pub size: u32,
}

/// A resize option which will resize the image to the given dimensions, without
/// maintaining the aspect ratio.
#[derive(
	Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, SimpleObject, InputObject,
)]
#[graphql(input_name = "ExactDimensionResizeInput")]
pub struct ExactDimensionResize {
	/// The width (in pixels) the resulting image should be resized to
	pub width: u32,
	/// The height (in pixels) the resulting image should be resized to
	pub height: u32,
}

#[derive(
	Debug,
	Default,
	Copy,
	Clone,
	Serialize,
	Deserialize,
	PartialEq,
	SimpleObject,
	InputObject,
)]
#[graphql(input_name = "ScaleEvenlyByFactorInput")]
pub struct ScaleEvenlyByFactor {
	/// The factor to scale the image by. Note that this was made a [Decimal]
	/// to correct precision issues
	pub factor: Decimal,
}

impl Eq for ScaleEvenlyByFactor {}

/// A resize option which will resize the image to fit within the given dimensions,
/// maintaining the aspect ratio.
///
/// If the image already fits within the dimensions, it will not be scaled up.
#[derive(
	Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, SimpleObject, InputObject,
)]
#[graphql(input_name = "FitWithinResizeInput")]
pub struct FitWithinResize {
	/// The maximum width (in pixels) of the resulting image
	pub width: u32,
	/// The maximum height (in pixels) of the resulting image
	pub height: u32,
}

/// The resize options to use when generating an image
#[derive(
	Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Union, OneofObject,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "ImageResizeMethodInput")]
pub enum ImageResizeMethod {
	Exact(ExactDimensionResize),
	ScaleEvenlyByFactor(ScaleEvenlyByFactor),
	ScaleDimension(ScaledDimensionResize),
	FitWithin(FitWithinResize),
}

// TODO(images): Support JpegXl and Avif

/// Supported image formats for processing images throughout Longbox
#[derive(Default, Copy, Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Enum)]
pub enum SupportedImageFormat {
	Webp,
	#[default]
	Jpeg,
	Png,
}

impl SupportedImageFormat {
	/// Get the file extension for the image format.
	pub fn extension(&self) -> &'static str {
		match self {
			SupportedImageFormat::Webp => "webp",
			SupportedImageFormat::Jpeg => "jpeg",
			SupportedImageFormat::Png => "png",
		}
	}
}

/// Options for processing images throughout Longbox.
#[derive(
	Default,
	Debug,
	Clone,
	Serialize,
	Deserialize,
	PartialEq,
	Eq,
	FromJsonQueryResult,
	SimpleObject,
	InputObject,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "ImageProcessorOptionsInput")]
pub struct ImageProcessorOptions {
	/// The size factor to use when generating an image. See [`ImageResizeOptions`]
	#[serde(default)]
	pub resize_method: Option<ImageResizeMethod>,
	/// The format to use when generating an image. See [`SupportedImageFormat`]
	#[serde(default)]
	pub format: SupportedImageFormat,
	/// The quality to use when generating an image. This is a number between 1 and 100,
	/// where 100 is the highest quality. Omitting this value will use the default quality
	/// of 100.
	pub quality: Option<u16>,
	/// The page to use when generating an image. This is not applicable to all media formats.
	pub page: Option<i32>,
}

/// The width (in pixels) a generated thumbnail is scaled to when nothing more specific has been
/// configured. Comfortably covers a 2x/3x DPR render of the ~200x300 CSS px grid covers the web
/// client displays.
pub const DEFAULT_THUMBNAIL_WIDTH: u32 = 512;
/// The encode quality used for generated thumbnails when nothing more specific has been configured.
pub const DEFAULT_THUMBNAIL_QUALITY: u16 = 80;

impl ImageProcessorOptions {
	/// Sane defaults for *thumbnail generation*: scale to [`DEFAULT_THUMBNAIL_WIDTH`] on the
	/// width axis (preserving aspect ratio), encoded as webp at
	/// [`DEFAULT_THUMBNAIL_QUALITY`].
	///
	/// Note that this deliberately differs from [`Default::default`], which yields
	/// `resize_method: None` (i.e. *no* resizing at all). `Default` is load-bearing as the serde
	/// default for persisted library configs and must not change, but using it as the fallback
	/// for thumbnail generation re-encodes the full-resolution source page as the "thumbnail" —
	/// which is how a library of ~850 books ended up with ~1MB, 1988x3057 "thumbnails" on disk.
	///
	/// Any code path which needs image options for generating a thumbnail, and which does not
	/// have an explicitly configured [`ImageProcessorOptions`] to use, should use this instead of
	/// `unwrap_or_default()`.
	pub fn thumbnail_default() -> Self {
		Self {
			resize_method: Some(ImageResizeMethod::ScaleDimension(
				ScaledDimensionResize {
					dimension: Dimension::Width,
					size: DEFAULT_THUMBNAIL_WIDTH,
				},
			)),
			format: SupportedImageFormat::Webp,
			quality: Some(DEFAULT_THUMBNAIL_QUALITY),
			page: None,
		}
	}

	pub fn with_page(self, page: i32) -> Self {
		Self {
			page: Some(page),
			..self
		}
	}
}

#[cfg(test)]
mod tests {
	use std::str::FromStr;

	use super::*;

	#[test]
	fn test_serialize_image_processor_options_exact_dimension() {
		let options = ImageProcessorOptions {
			resize_method: Some(ImageResizeMethod::Exact(ExactDimensionResize {
				width: 800,
				height: 600,
			})),
			format: SupportedImageFormat::Webp,
			quality: Some(90),
			page: Some(1),
		};

		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":{"exact":{"width":800,"height":600}},"format":"Webp","quality":90,"page":1}"#
		);
	}

	#[test]
	fn test_serialize_image_processor_options_scale_evenly() {
		let options = ImageProcessorOptions {
			resize_method: Some(ImageResizeMethod::ScaleEvenlyByFactor(
				ScaleEvenlyByFactor {
					factor: Decimal::from_str("0.65").unwrap(),
				},
			)),
			format: SupportedImageFormat::Webp,
			quality: Some(90),
			page: Some(1),
		};

		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":{"scaleEvenlyByFactor":{"factor":"0.65"}},"format":"Webp","quality":90,"page":1}"#
		);
	}

	#[test]
	fn test_serialize_image_processor_options_scaled_dimension() {
		let options = ImageProcessorOptions {
			resize_method: Some(ImageResizeMethod::ScaleDimension(
				ScaledDimensionResize {
					dimension: Dimension::Height,
					size: 600,
				},
			)),
			format: SupportedImageFormat::Webp,
			quality: Some(90),
			page: Some(1),
		};
		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":{"scaleDimension":{"dimension":"Height","size":600}},"format":"Webp","quality":90,"page":1}"#
		);

		let options = ImageProcessorOptions {
			resize_method: Some(ImageResizeMethod::ScaleDimension(
				ScaledDimensionResize {
					dimension: Dimension::Width,
					size: 800,
				},
			)),
			..options
		};
		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":{"scaleDimension":{"dimension":"Width","size":800}},"format":"Webp","quality":90,"page":1}"#
		);
	}

	#[test]
	fn test_thumbnail_default_actually_resizes() {
		let options = ImageProcessorOptions::thumbnail_default();

		assert_eq!(
			options.resize_method,
			Some(ImageResizeMethod::ScaleDimension(ScaledDimensionResize {
				dimension: Dimension::Width,
				size: DEFAULT_THUMBNAIL_WIDTH,
			})),
			"thumbnail_default must resize -- a `None` resize method re-encodes the full-resolution source page"
		);
		assert_eq!(options.format, SupportedImageFormat::Webp);
		assert_eq!(options.quality, Some(DEFAULT_THUMBNAIL_QUALITY));
		assert_eq!(options.page, None);
	}

	#[test]
	fn test_thumbnail_default_is_not_derived_default() {
		assert_ne!(
			ImageProcessorOptions::thumbnail_default(),
			ImageProcessorOptions::default()
		);
	}

	/// The derived [`Default`] is used as the serde default for persisted library configs, so it
	/// must keep deserializing stored JSON the same way. Changing it (rather than adding
	/// `thumbnail_default`) would silently rewrite existing library configurations.
	#[test]
	fn test_derived_default_is_unchanged() {
		let options = ImageProcessorOptions::default();
		assert_eq!(options.resize_method, None);
		assert_eq!(options.format, SupportedImageFormat::Jpeg);
		assert_eq!(options.quality, None);
		assert_eq!(options.page, None);

		let deserialized = serde_json::from_str::<ImageProcessorOptions>(
			r#"{"quality":null,"page":null}"#,
		)
		.expect("Failed to deserialize a partial, persisted config");
		assert_eq!(deserialized, options);
	}

	#[test]
	fn test_thumbnail_default_round_trips() {
		let options = ImageProcessorOptions::thumbnail_default();
		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":{"scaleDimension":{"dimension":"Width","size":512}},"format":"Webp","quality":80,"page":null}"#
		);
		assert_eq!(
			serde_json::from_str::<ImageProcessorOptions>(&serialized).unwrap(),
			options
		);
	}

	#[test]
	fn test_serialize_image_processor_options_none() {
		let options = ImageProcessorOptions {
			resize_method: None,
			format: SupportedImageFormat::Webp,
			quality: Some(90),
			page: Some(1),
		};
		let serialized = serde_json::to_string(&options).unwrap();
		assert_eq!(
			serialized,
			r#"{"resizeMethod":null,"format":"Webp","quality":90,"page":1}"#
		);
	}
}
