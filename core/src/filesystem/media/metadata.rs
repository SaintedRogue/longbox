use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};
use merge::Merge;
use pdf::{
	object::InfoDict,
	primitive::{Dictionary, PdfString},
};
use regex::Regex;
use sea_orm::{prelude::*, Set};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::utils::serde::{
	age_rating_deserializer, optional_f64_deserializer, optional_i32_deserializer,
	parse_age_restriction, string_list_deserializer,
};

const NAIVE_DATE_FORMATS: [&str; 2] = ["%Y-%m-%d", "%m-%d-%Y"];

// NOTE: alias is used primarily to support ComicInfo.xml files, as that metadata
// is formatted in PascalCase

/// Struct representing the metadata for a processed file.
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, Default, Merge)]
pub struct ProcessedMediaMetadata {
	/// The binding format for scanned physical books or presentation format for digital sources
	/// See https://anansi-project.github.io/docs/comicinfo/documentation#format
	#[serde(alias = "Format")]
	pub format: Option<String>,
	/// The title of the media.
	#[serde(alias = "Title")]
	pub title: Option<String>,
	/// Alternative title used for sorting
	#[serde(alias = "TitleSort")]
	pub title_sort: Option<String>,
	/// The series name which the media belongs to. This isn't necessarily the same as the
	/// series name as it was interpreted by Stump.
	#[serde(alias = "Series")]
	pub series: Option<String>,
	/// The series group which the media belongs to.
	/// See https://anansi-project.github.io/docs/comicinfo/documentation#seriesgroup
	#[serde(alias = "SeriesGroup")]
	pub series_group: Option<String>,
	/// The story arc which the media belongs to.
	/// See https://anansi-project.github.io/docs/comicinfo/documentation#storyarc
	#[serde(alias = "StoryArc")]
	pub story_arc: Option<String>,
	/// The number this media is in the story arc.
	/// See https://anansi-project.github.io/docs/comicinfo/documentation#storyarcnumber
	#[serde(
		default,
		alias = "StoryArcNumber",
		deserialize_with = "optional_f64_deserializer"
	)]
	pub story_arc_number: Option<f64>,
	/// The number this media is in the series. This can be a float, e.g. 20.1,
	/// which typically represents a one-shot or special issue.
	#[serde(
		default,
		alias = "Number",
		alias = "series_index",
		deserialize_with = "optional_f64_deserializer"
	)]
	pub number: Option<f64>,
	#[serde(
		default,
		alias = "Volume",
		deserialize_with = "optional_i32_deserializer"
	)]
	pub volume: Option<i32>,
	/// The summary of the media.
	#[serde(alias = "Summary")]
	pub summary: Option<String>,
	/// Optional notes about the media.
	#[serde(alias = "Notes")]
	pub notes: Option<String>,
	/// The age rating of the media. This varies a lot between media, but Stump will try
	/// to normalize it to a number between 0 and 18.
	#[serde(
		default,
		alias = "AgeRating",
		deserialize_with = "age_rating_deserializer"
	)]
	pub age_rating: Option<i32>,
	/// The genre(s) the media belongs to.
	#[serde(
		alias = "Genre",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub genres: Option<Vec<String>>,
	/// The tag(s) the media belongs to. Unlike genres, these are stored as first-class
	/// `Tag` entities and linked to the media via the `media_tags` junction table.
	#[serde(
		alias = "Tags",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub tags: Option<Vec<String>>,
	/// The language of the media. ComicInfo's standard element is LanguageISO.
	#[serde(alias = "LanguageISO")]
	pub language: Option<String>,
	/// Non-standard `Language` element kept for files already in the wild that
	/// use it instead of (or alongside) `LanguageISO`. Deliberately a separate
	/// field: serde's `alias` gives one "seen" slot per *field*, not per alias,
	/// so aliasing both elements onto `language` would hard-fail the entire
	/// parse (serde-rs/serde#2380) whenever both elements are present in the
	/// same document. Never serialized; only `language` (LanguageISO) is
	/// written back. Merged into `language` in `into_active_model` when
	/// LanguageISO was absent.
	#[serde(alias = "Language", skip_serializing)]
	pub language_non_standard: Option<String>,
	/// GTIN (ISBN/EAN/UPC) — ComicInfo v2.1
	#[serde(alias = "GTIN")]
	pub gtin: Option<String>,
	/// The translator(s) of the associated media — ComicInfo v2.1
	#[serde(
		alias = "Translator",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub translators: Option<Vec<String>>,

	/// The year the media was published.
	#[serde(
		default,
		alias = "Year",
		deserialize_with = "optional_i32_deserializer"
	)]
	pub year: Option<i32>,
	/// The month the media was published (1-12)
	#[serde(
		default,
		alias = "Month",
		deserialize_with = "optional_i32_deserializer"
	)]
	pub month: Option<i32>,
	/// The day the media was published (1-31). The day is not validated against the month.
	#[serde(default, alias = "Day", deserialize_with = "optional_i32_deserializer")]
	pub day: Option<i32>,

	// Note: We don't really need the PascalCase aliases for ebook-specific data
	/// Amazon identifier
	pub identifier_amazon: Option<String>,
	/// Calibre identifier
	pub identifier_calibre: Option<String>,
	/// Google Books identifier
	pub identifier_google: Option<String>,
	/// ISBN identifier
	pub identifier_isbn: Option<String>,
	/// Mobi ASIN identifier
	pub identifier_mobi_asin: Option<String>,
	/// UUID identifier
	pub identifier_uuid: Option<String>,

	/// The writer(s) of the associated media
	#[serde(
		alias = "Writer",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub writers: Option<Vec<String>>,
	/// The penciller(s) of the associated media
	#[serde(
		alias = "Penciller",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub pencillers: Option<Vec<String>>,
	/// The inker(s) of the associated media
	#[serde(
		alias = "Inker",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub inkers: Option<Vec<String>>,
	/// The colorist(s) of the associated media
	#[serde(
		alias = "Colorist",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub colorists: Option<Vec<String>>,
	/// The letterer(s) of the associated media
	#[serde(
		alias = "Letterer",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub letterers: Option<Vec<String>>,
	/// The cover artist(s) of the associated media
	#[serde(
		alias = "CoverArtist",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub cover_artists: Option<Vec<String>>,
	/// The editor(s) of the associated media
	#[serde(
		alias = "Editor",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub editors: Option<Vec<String>>,
	/// The publisher of the associated media
	#[serde(alias = "Publisher")]
	pub publisher: Option<String>,

	/// Link(s) to the associated media, e.g. a comixology link
	#[serde(
		alias = "Web",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub links: Option<Vec<String>>,
	/// A list of characters that appear in the associated media
	#[serde(
		alias = "Characters",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub characters: Option<Vec<String>>,
	/// A list of teams that appear in the associated media
	#[serde(
		alias = "Teams",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub teams: Option<Vec<String>>,
	/// The number of pages in the associated media. This does *not* take priority over
	/// the number of pages detected by the file processor.
	#[serde(
		default,
		alias = "PageCount",
		deserialize_with = "optional_i32_deserializer"
	)]
	pub page_count: Option<i32>,
	/// ComicVine issue ID recovered from ComicTagger's Notes convention
	/// ("[Issue ID N]") or a comicvine.gamespot.com Web URL ("/4000-N/").
	/// Not a ComicInfo element; derived post-parse.
	#[serde(skip)]
	pub comicvine_id: Option<String>,
}

/// Recover a ComicVine issue ID from ComicTagger's conventions: either the
/// "[Issue ID N]" marker it appends to Notes, or a comicvine.gamespot.com Web
/// URL of the form ".../4000-N/". Notes wins when both are present.
pub fn extract_comicvine_id(notes: Option<&str>, links: &[String]) -> Option<String> {
	static NOTES_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
	static WEB_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

	let notes_re =
		NOTES_RE.get_or_init(|| Regex::new(r"\[Issue ID (\d+)\]").expect("valid regex"));
	let web_re = WEB_RE.get_or_init(|| {
		Regex::new(r"comicvine\.gamespot\.com/[^\s]*?/4000-(\d+)").expect("valid regex")
	});

	if let Some(caps) = notes.and_then(|n| notes_re.captures(n)) {
		return Some(caps[1].to_string());
	}

	links
		.iter()
		.find_map(|link| web_re.captures(link).map(|caps| caps[1].to_string()))
}

impl ProcessedMediaMetadata {
	pub fn into_active_model(self) -> models::entity::media_metadata::ActiveModel {
		models::entity::media_metadata::ActiveModel {
			format: Set(self.format),
			title: Set(self.title),
			title_sort: Set(self.title_sort),
			series: Set(self.series),
			series_group: Set(self.series_group),
			story_arc: Set(self.story_arc),
			story_arc_number: Set(self
				.story_arc_number
				.and_then(|n| Decimal::try_from(n).ok())),
			number: Set(self.number.and_then(|n| Decimal::try_from(n).ok())),
			volume: Set(self.volume),
			summary: Set(self.summary),
			notes: Set(self.notes),
			age_rating: Set(self.age_rating),
			genres: Set(self.genres.map(|v| v.join(", "))),
			year: Set(self.year),
			month: Set(self.month),
			day: Set(self.day),
			writers: Set(self.writers.map(|v| v.join(", "))),
			pencillers: Set(self.pencillers.map(|v| v.join(", "))),
			inkers: Set(self.inkers.map(|v| v.join(", "))),
			colorists: Set(self.colorists.map(|v| v.join(", "))),
			letterers: Set(self.letterers.map(|v| v.join(", "))),
			cover_artists: Set(self.cover_artists.map(|v| v.join(", "))),
			editors: Set(self.editors.map(|v| v.join(", "))),
			publisher: Set(self.publisher),
			links: Set(self.links.map(|v| v.join(", "))),
			characters: Set(self.characters.map(|v| v.join(", "))),
			teams: Set(self.teams.map(|v| v.join(", "))),
			page_count: Set(self.page_count),
			// LanguageISO (the standard element) wins when both are present.
			language: Set(self.language.or(self.language_non_standard)),
			identifier_amazon: Set(self.identifier_amazon),
			identifier_calibre: Set(self.identifier_calibre),
			identifier_google: Set(self.identifier_google),
			// GTIN is a superset of ISBN — mapping to the ISBN identifier column
			// follows Kavita/Komga precedent, but never clobbers an explicit ISBN.
			identifier_isbn: Set(self.identifier_isbn.or(self.gtin)),
			identifier_mobi_asin: Set(self.identifier_mobi_asin),
			identifier_uuid: Set(self.identifier_uuid),
			translators: Set(self.translators.map(|v| v.join(", "))),
			comicvine_id: Set(self.comicvine_id),
			..Default::default()
		}
	}
}

// NOTE: this is primarily used for converting the EPUB metadata into a common Metadata struct
impl From<HashMap<String, Vec<String>>> for ProcessedMediaMetadata {
	fn from(map: HashMap<String, Vec<String>>) -> Self {
		let mut metadata = ProcessedMediaMetadata::default();

		for (key, value) in map {
			match key.to_lowercase().as_str() {
				"title" => metadata.title = Some(value.join("\n").to_string()),
				"title_sort" => metadata.title_sort = Some(value.join("\n").to_string()),
				"series" | "collection_name" => {
					metadata.series = Some(value.join("\n").to_string())
				},
				"number" | "series_index" | "collection_position" => {
					metadata.number =
						value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"volume" => {
					metadata.volume =
						value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"summary" | "description" | "synopsis" => {
					metadata.summary = Some(value.join("\n").to_string())
				},
				"notes" => metadata.notes = Some(value.join("\n").to_string()),
				"genre" | "genres" | "subject" | "subjects" => {
					metadata.genres = Some(value)
				},
				"tag" | "tags" => {
					metadata.tags = Some(
						value
							.into_iter()
							.flat_map(|v| {
								v.split(',')
									.map(|s| s.trim().to_owned())
									.collect::<Vec<_>>()
							})
							.filter(|s| !s.is_empty())
							.collect(),
					)
				},
				"year" => {
					metadata.year = value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"month" => {
					metadata.month =
						value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"day" => {
					metadata.day = value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"language" => metadata.language = Some(value.join("\n").to_string()),
				"identifier_amazon" => {
					metadata.identifier_amazon = Some(value.join("\n").to_string())
				},
				"identifier_calibre" => {
					metadata.identifier_calibre = Some(value.join("\n").to_string())
				},
				"identifier_google" => {
					metadata.identifier_google = Some(value.join("\n").to_string())
				},
				"identifier_isbn" => {
					metadata.identifier_isbn = Some(value.join("\n").to_string())
				},
				"identifier_mobi_asin" | "identifier_mobi-asin" => {
					metadata.identifier_mobi_asin = Some(value.join("\n").to_string())
				},
				"identifier_uuid" => {
					metadata.identifier_uuid = Some(value.join("\n").to_string())
				},
				"pencillers" => metadata.pencillers = Some(value),
				"inkers" => metadata.inkers = Some(value),
				"colorists" => metadata.colorists = Some(value),
				"letterers" => metadata.letterers = Some(value),
				"coverartists" => metadata.cover_artists = Some(value),
				"editors" => metadata.editors = Some(value),
				"publisher" => metadata.publisher = Some(value.join("\n").to_string()),
				"links" => metadata.links = Some(value),
				"characters" => metadata.characters = Some(value),
				"teams" => metadata.teams = Some(value),
				"pagecount" => {
					metadata.page_count =
						value.into_iter().next().and_then(|n| n.parse().ok());
				},
				"date" => {
					// Note: we don't know the format of the date. It could be a year, a full date, etc.
					// We need to _try_ to parse each part of the date, and if it fails, we just ignore it.
					// This is a bit of a hack, but it's the best we can do without knowing the format.
					let raw_date = value.into_iter().next().unwrap_or_default();

					for format in &NAIVE_DATE_FORMATS {
						if let Ok(date) = NaiveDate::parse_from_str(&raw_date, format) {
							metadata.year = Some(date.year());
							metadata.month = Some(date.month() as i32);
							metadata.day = Some(date.day() as i32);
							break;
						}
					}

					if metadata.year.is_none() {
						if let Ok(year) = raw_date.parse() {
							metadata.year = Some(year);
						}
					}
				},
				// TODO: separate out writer vs author?
				"creator" | "author" | "writers" => match metadata.writers {
					Some(ref mut writers) => {
						writers.extend(value);
						// remove duplicates
						writers.sort();
						writers.dedup();
					},
					None => metadata.writers = Some(value),
				},
				"typicalagerange" | "contentrating" => {
					let parsed = value
						.into_iter()
						.next()
						.as_deref()
						.and_then(parse_age_restriction);

					match (metadata.age_rating, parsed) {
						// if metadata.age_rating has been set, we need to take the min of the two
						(Some(existing), Some(new)) => {
							metadata.age_rating = Some(existing.min(new));
						},
						// if metadata.age_rating has not been set, we can just take the new value
						(_, Some(new)) => metadata.age_rating = Some(new),
						_ => (),
					}
				},
				_ => (),
			}
		}

		metadata
	}
}

impl From<Dictionary> for ProcessedMediaMetadata {
	fn from(dict: Dictionary) -> Self {
		// FIXME: this is pretty hacky! I need to match on the type of the value
		let map = dict
			.into_iter()
			.map(|(k, v)| v.to_string().map(|v| (k, v)))
			.filter_map(Result::ok)
			.map(|(k, v)| (k.to_lowercase(), vec![v]))
			.collect::<HashMap<String, Vec<String>>>();
		Self::from(map)
	}
}

fn pdf_string_to_string(pdf_string: PdfString) -> Option<String> {
	pdf_string.to_string().map_or_else(
		|error| {
			tracing::error!(error = ?error, "Failed to convert PdfString to String");
			None
		},
		|str| Some(str.trim().to_owned()),
	)
}

impl From<InfoDict> for ProcessedMediaMetadata {
	fn from(dict: InfoDict) -> Self {
		ProcessedMediaMetadata {
			title: dict.title.and_then(pdf_string_to_string),
			genres: dict.subject.and_then(pdf_string_to_string).map(|v| vec![v]),
			year: dict.creation_date.as_ref().map(|date| date.year as i32),
			month: dict.creation_date.as_ref().map(|date| date.month as i32),
			day: dict.creation_date.as_ref().map(|date| date.day as i32),
			writers: dict.author.and_then(pdf_string_to_string).map(|v| vec![v]),
			..Default::default()
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_pdf_string_to_string() {
		let pdf_string = PdfString::from("Hello, world!");
		assert_eq!(
			pdf_string_to_string(pdf_string),
			Some("Hello, world!".to_string())
		);
	}

	#[test]
	fn test_from_hashmap() {
		let mut map = HashMap::new();

		map.insert("Title".to_string(), vec![String::from("The Way of Kings")]);
		map.insert(
			"creator".to_string(),
			vec![String::from("Brandon Sanderson")],
		);
		map.insert("date".to_string(), vec![String::from("08-31-2010")]);
		map.insert("Genre".to_string(), vec![String::from("Fantasy")]);
		map.insert(
			"Summary".to_string(),
			vec![String::from("A book, you know?")],
		);
		map.insert(
			"tags".to_string(),
			vec![String::from("epic"), String::from("high-fantasy")],
		);

		let metadata = ProcessedMediaMetadata::from(map);

		assert_eq!(metadata.title, Some("The Way of Kings".to_string()));
		assert_eq!(
			metadata.writers,
			Some(vec!["Brandon Sanderson".to_string()])
		);
		assert_eq!(metadata.year, Some(2010));
		assert_eq!(metadata.month, Some(8));
		assert_eq!(metadata.day, Some(31));
		assert_eq!(metadata.genres, Some(vec!["Fantasy".to_string()]));
		assert_eq!(
			metadata.tags,
			Some(vec!["epic".to_string(), "high-fantasy".to_string()])
		);
		assert_eq!(metadata.summary, Some("A book, you know?".to_string()));
	}

	#[test]
	fn test_from_hashmap_splits_comma_separated_tags() {
		let mut map = HashMap::new();
		map.insert(
			"tags".to_string(),
			vec![
				String::from("epic, high-fantasy"),
				String::from("  standalone "),
				String::from(""),
			],
		);

		let metadata = ProcessedMediaMetadata::from(map);

		assert_eq!(
			metadata.tags,
			Some(vec![
				"epic".to_string(),
				"high-fantasy".to_string(),
				"standalone".to_string(),
			])
		);
	}

	#[test]
	fn test_resolve_multiple_age_ratings() {
		let mut map = HashMap::new();

		map.insert("Title".to_string(), vec![String::from("The Way of Kings")]);
		map.insert("typicalAgeRange".to_string(), vec![String::from("14-17")]);
		map.insert("ContentRating".to_string(), vec![String::from("13+")]);

		let metadata = ProcessedMediaMetadata::from(map);

		assert_eq!(metadata.age_rating, Some(13));
	}

	#[test]
	fn test_parse_language_iso() {
		let xml = r#"<?xml version="1.0"?><ComicInfo><LanguageISO>en</LanguageISO></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		assert_eq!(meta.language, Some("en".to_string()));
	}

	#[test]
	fn test_parse_both_language_elements_prefers_iso() {
		let xml = r#"<?xml version="1.0"?><ComicInfo><Language>English</Language><LanguageISO>en</LanguageISO><Series>X</Series></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		let active = meta.into_active_model();
		assert_eq!(active.language.unwrap(), Some("en".to_string()));
	}

	#[test]
	fn test_parse_legacy_language_only() {
		let xml =
			r#"<?xml version="1.0"?><ComicInfo><Language>English</Language></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		let active = meta.into_active_model();
		assert_eq!(active.language.unwrap(), Some("English".to_string()));
	}

	#[test]
	fn test_parse_gtin_and_translator() {
		let xml = r#"<?xml version="1.0"?><ComicInfo><GTIN>9781779501127</GTIN><Translator>Jocelyne Allen, Zack Davisson</Translator></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		assert_eq!(meta.gtin, Some("9781779501127".to_string()));
		assert_eq!(
			meta.translators,
			Some(vec![
				"Jocelyne Allen".to_string(),
				"Zack Davisson".to_string()
			])
		);
	}

	#[test]
	fn test_gtin_does_not_clobber_isbn() {
		let meta = ProcessedMediaMetadata {
			identifier_isbn: Some("1234".to_string()),
			gtin: Some("5678".to_string()),
			..Default::default()
		};
		let active = meta.into_active_model();
		assert_eq!(active.identifier_isbn.unwrap(), Some("1234".to_string()));
	}

	#[test]
	fn test_extract_comicvine_id_from_notes() {
		let notes = "Tagged with ComicTagger 1.3.0-alpha.0 using info from Comic Vine on 2021-12-01 20:34:52.  [Issue ID 517895]";
		assert_eq!(
			extract_comicvine_id(Some(notes), &[]),
			Some("517895".to_string())
		);
	}

	#[test]
	fn test_extract_comicvine_id_from_web_url() {
		let links =
			vec!["https://comicvine.gamespot.com/delete-1/4000-517895/".to_string()];
		assert_eq!(
			extract_comicvine_id(None, &links),
			Some("517895".to_string())
		);
	}

	#[test]
	fn test_extract_comicvine_id_notes_wins_over_web() {
		let links = vec!["https://comicvine.gamespot.com/x/4000-999999/".to_string()];
		assert_eq!(
			extract_comicvine_id(Some("blah [Issue ID 517895]"), &links),
			Some("517895".to_string())
		);
	}

	#[test]
	fn test_extract_comicvine_id_malformed() {
		assert_eq!(extract_comicvine_id(Some("[Issue ID ]"), &[]), None);
		assert_eq!(extract_comicvine_id(Some("[Issue ID abc]"), &[]), None);
		assert_eq!(
			extract_comicvine_id(None, &["https://example.com/4000-not-cv/".to_string()]),
			None
		);
		assert_eq!(extract_comicvine_id(None, &[]), None);
	}

	#[test]
	fn test_extract_comicvine_id_multiple_takes_first() {
		assert_eq!(
			extract_comicvine_id(Some("[Issue ID 111] and [Issue ID 222]"), &[]),
			Some("111".to_string())
		);
	}

	#[test]
	fn test_metadata_from_buf_hydrates_comicvine_id() {
		let metadata = crate::filesystem::media::utils::metadata_from_buf(
			crate::filesystem::media::utils::tests::INCOMPLETE_METADATA_FIXTURE,
		)
		.unwrap();
		assert_eq!(metadata.comicvine_id, Some("517895".to_string()));
	}
}
