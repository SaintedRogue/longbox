use serde::{Deserialize, Serialize};

use crate::filesystem::{
	image::{PlaceholderGenerationJobConfig, ThumbnailGenerationJobParams},
	media::analysis::AnalysisJobConfig,
	metadata::MetadataFetchJobParams,
	organizer::OrganizeMode,
	scanner::ScanOptions,
};

use models::shared::image_processor_options::ImageProcessorOptions;

/// A unified job enum that can represent any job in the system.
/// This is the type stored in the apalis `MemoryStorage` and is what
/// gets enqueued via `Ctx::enqueue()`.
///
/// Each variant contains the data needed to construct and run the corresponding job.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LongboxJob {
	LibraryScan {
		id: String,
		path: String,
		options: Option<ScanOptions>,
	},
	SeriesScan {
		id: String,
		path: String,
		options: Option<ScanOptions>,
	},
	ThumbnailGeneration {
		options: ImageProcessorOptions,
		params: ThumbnailGenerationJobParams,
	},
	PlaceholderGeneration {
		config: PlaceholderGenerationJobConfig,
	},
	MetadataFetch {
		params: MetadataFetchJobParams,
	},
	AnalyzeMedia {
		config: AnalysisJobConfig,
	},
	OrganizeLooseFiles {
		library_id: String,
		mode: OrganizeMode,
	},
}

impl LongboxJob {
	/// Returns the human-readable name of the job
	pub fn name(&self) -> &'static str {
		match self {
			LongboxJob::LibraryScan { .. } => "library_scan",
			LongboxJob::SeriesScan { .. } => "series_scan",
			LongboxJob::ThumbnailGeneration { .. } => "thumbnail_generation",
			LongboxJob::PlaceholderGeneration { .. } => "placeholder_generation",
			LongboxJob::MetadataFetch { .. } => "metadata_fetch",
			LongboxJob::AnalyzeMedia { .. } => "analyze_media",
			LongboxJob::OrganizeLooseFiles { .. } => "organize_loose_files",
		}
	}

	/// Returns a description for the job
	pub fn description(&self) -> Option<String> {
		match self {
			LongboxJob::LibraryScan { path, .. } => Some(path.clone()),
			LongboxJob::SeriesScan { path, .. } => Some(path.clone()),
			LongboxJob::ThumbnailGeneration { params, .. } => {
				Some(format!("Thumbnail generation: {:?}", params))
			},
			LongboxJob::PlaceholderGeneration { .. } => Some(
				"Generate placeholder thumbnail metadata for media, series, or libraries"
					.to_string(),
			),
			LongboxJob::MetadataFetch { params } => {
				Some(format!("Metadata fetch: {:?}", params.scope))
			},
			LongboxJob::AnalyzeMedia { config } => {
				Some(format!("Analyze media: {:?}", config.scope))
			},
			LongboxJob::OrganizeLooseFiles { library_id, .. } => {
				Some(format!("Organize loose files: {library_id}"))
			},
		}
	}

	pub fn library_scan(id: String, path: String, options: Option<ScanOptions>) -> Self {
		LongboxJob::LibraryScan { id, path, options }
	}

	pub fn series_scan(id: String, path: String, options: Option<ScanOptions>) -> Self {
		LongboxJob::SeriesScan { id, path, options }
	}

	pub fn thumbnail_generation(
		options: ImageProcessorOptions,
		params: ThumbnailGenerationJobParams,
	) -> Self {
		LongboxJob::ThumbnailGeneration { options, params }
	}

	pub fn placeholder_generation(config: PlaceholderGenerationJobConfig) -> Self {
		LongboxJob::PlaceholderGeneration { config }
	}

	pub fn metadata_fetch(params: MetadataFetchJobParams) -> Self {
		LongboxJob::MetadataFetch { params }
	}

	pub fn analyze_media(config: AnalysisJobConfig) -> Self {
		LongboxJob::AnalyzeMedia { config }
	}

	pub fn organize_loose_files(library_id: String, mode: OrganizeMode) -> Self {
		LongboxJob::OrganizeLooseFiles { library_id, mode }
	}
}
