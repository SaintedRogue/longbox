use models::entity::media_metadata;
use serde::Serialize;
use serde_with::skip_serializing_none;

use crate::filesystem::error::FileError;

/// ComicInfo.xml (Anansi Project) serialization target. Field order follows
/// the published schema; None fields are omitted entirely.
#[skip_serializing_none]
#[derive(Debug, Default, Serialize)]
#[serde(rename = "ComicInfo")]
pub struct ComicInfoXml {
	#[serde(rename = "Title")]
	pub title: Option<String>,
	#[serde(rename = "Series")]
	pub series: Option<String>,
	#[serde(rename = "Number")]
	pub number: Option<String>,
	#[serde(rename = "Volume")]
	pub volume: Option<i32>,
	#[serde(rename = "Summary")]
	pub summary: Option<String>,
	#[serde(rename = "Notes")]
	pub notes: Option<String>,
	#[serde(rename = "Year")]
	pub year: Option<i32>,
	#[serde(rename = "Month")]
	pub month: Option<i32>,
	#[serde(rename = "Day")]
	pub day: Option<i32>,
	#[serde(rename = "Writer")]
	pub writer: Option<String>,
	#[serde(rename = "Penciller")]
	pub penciller: Option<String>,
	#[serde(rename = "Inker")]
	pub inker: Option<String>,
	#[serde(rename = "Colorist")]
	pub colorist: Option<String>,
	#[serde(rename = "Letterer")]
	pub letterer: Option<String>,
	#[serde(rename = "CoverArtist")]
	pub cover_artist: Option<String>,
	#[serde(rename = "Editor")]
	pub editor: Option<String>,
	#[serde(rename = "Translator")]
	pub translator: Option<String>,
	#[serde(rename = "Publisher")]
	pub publisher: Option<String>,
	#[serde(rename = "Genre")]
	pub genre: Option<String>,
	#[serde(rename = "Tags")]
	pub tags: Option<String>,
	#[serde(rename = "Web")]
	pub web: Option<String>,
	#[serde(rename = "PageCount")]
	pub page_count: Option<i32>,
	#[serde(rename = "LanguageISO")]
	pub language_iso: Option<String>,
	#[serde(rename = "Format")]
	pub format: Option<String>,
	#[serde(rename = "AgeRating")]
	pub age_rating: Option<String>,
	#[serde(rename = "Characters")]
	pub characters: Option<String>,
	#[serde(rename = "Teams")]
	pub teams: Option<String>,
	#[serde(rename = "GTIN")]
	pub gtin: Option<String>,
	#[serde(rename = "StoryArc")]
	pub story_arc: Option<String>,
	#[serde(rename = "StoryArcNumber")]
	pub story_arc_number: Option<String>,
	#[serde(rename = "SeriesGroup")]
	pub series_group: Option<String>,
	#[serde(rename = "TitleSort")]
	pub title_sort: Option<String>,
}

impl From<&media_metadata::Model> for ComicInfoXml {
	fn from(m: &media_metadata::Model) -> Self {
		Self {
			title: m.title.clone(),
			title_sort: m.title_sort.clone(),
			series: m.series.clone(),
			series_group: m.series_group.clone(),
			number: m.number.map(|n| n.normalize().to_string()),
			volume: m.volume,
			summary: m.summary.clone(),
			notes: m.notes.clone(),
			year: m.year,
			month: m.month,
			day: m.day,
			writer: m.writers.clone(),
			penciller: m.pencillers.clone(),
			inker: m.inkers.clone(),
			colorist: m.colorists.clone(),
			letterer: m.letterers.clone(),
			cover_artist: m.cover_artists.clone(),
			editor: m.editors.clone(),
			translator: m.translators.clone(),
			publisher: m.publisher.clone(),
			genre: m.genres.clone(),
			tags: None, // tags are first-class entities, not on this row
			web: m.links.clone(),
			page_count: m.page_count,
			language_iso: m.language.clone(),
			format: m.format.clone(),
			age_rating: m.age_rating.map(|r| r.to_string()),
			characters: m.characters.clone(),
			teams: m.teams.clone(),
			gtin: m.identifier_isbn.clone(),
			story_arc: m.story_arc.clone(),
			story_arc_number: m.story_arc_number.map(|n| n.normalize().to_string()),
		}
	}
}

impl ComicInfoXml {
	pub fn to_xml_string(&self) -> Result<String, FileError> {
		let body = quick_xml::se::to_string(self)
			.map_err(|e| FileError::UnknownError(e.to_string()))?;
		Ok(format!(
			"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n{body}"
		))
	}
}

#[cfg(test)]
mod tests {
	use rust_decimal::Decimal;

	use super::*;
	use crate::filesystem::media::utils::metadata_from_buf;

	fn sample_model() -> media_metadata::Model {
		media_metadata::Model {
			title: Some("Delete".to_string()),
			series: Some("Delete".to_string()),
			number: Some(Decimal::from(1)),
			volume: Some(2016),
			summary: Some("A summary".to_string()),
			notes: Some("[Issue ID 517895]".to_string()),
			year: Some(2016),
			month: Some(3),
			day: Some(31),
			writers: Some("Jimmy Palmiotti, Justin Gray".to_string()),
			pencillers: Some("John Timms".to_string()),
			publisher: Some("1First Comics".to_string()),
			links: Some(
				"https://comicvine.gamespot.com/delete-1/4000-517895/".to_string(),
			),
			language: Some("en".to_string()),
			translators: Some("A Translator".to_string()),
			page_count: Some(27),
			..Default::default()
		}
	}

	#[test]
	fn test_serialize_produces_parseable_comicinfo() {
		let xml = ComicInfoXml::from(&sample_model()).to_xml_string().unwrap();
		assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"utf-8\"?>"));
		assert!(xml.contains("<Series>Delete</Series>"));
		assert!(xml.contains("<Writer>Jimmy Palmiotti, Justin Gray</Writer>"));
		assert!(xml.contains("<LanguageISO>en</LanguageISO>"));
		assert!(xml.contains("<Translator>A Translator</Translator>"));
		assert!(!xml.contains("<Tags")); // None fields are omitted, not emitted empty
	}

	#[test]
	fn test_round_trip_through_parser() {
		let model = sample_model();
		let xml = ComicInfoXml::from(&model).to_xml_string().unwrap();
		let parsed = metadata_from_buf(&xml).expect("round-tripped XML must parse");
		assert_eq!(parsed.series, Some("Delete".to_string()));
		assert_eq!(parsed.number, Some(1f64));
		assert_eq!(parsed.volume, Some(2016));
		assert_eq!(parsed.language, Some("en".to_string()));
		assert_eq!(
			parsed.writers,
			Some(vec![
				"Jimmy Palmiotti".to_string(),
				"Justin Gray".to_string()
			])
		);
		assert_eq!(parsed.comicvine_id, Some("517895".to_string()));
	}
}
