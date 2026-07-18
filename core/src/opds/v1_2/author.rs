//! This module defines [`LongboxAuthor`] struct for representing the `atom:author` of an OPDS feed entry
//! as specified at https://specs.opds.io/opds-1.2#51-metadata

use xml::EventWriter;

use super::util;
use crate::error::CoreResult;

/// Represents an author in an OPDS feed as specified at
/// https://specs.opds.io/opds-1.2#51-metadata
pub struct LongboxAuthor {
	pub name: String,
	pub uri: Option<String>,
}

impl Default for LongboxAuthor {
	fn default() -> Self {
		Self {
			name: "Longbox".to_string(),
			uri: Some("https://github.com/stumpapp/stump".to_string()),
		}
	}
}

impl LongboxAuthor {
	/// Creates a new author.
	pub fn new(name: String, uri: Option<String>) -> LongboxAuthor {
		LongboxAuthor { name, uri }
	}

	/// Writes the [`LongboxAuthor`] instance as XML.
	///
	/// ## Example
	/// ```no_run
	/// use longbox_core::opds::v1_2::author::LongboxAuthor;
	/// use xml::EventWriter;
	///
	/// let author = LongboxAuthor::new("Aaron Leopold".to_string(), None);
	/// let xml_str = r#"<?xml version="1.0" encoding="UTF-8"?><author><name>Aaron Leopold</name></author>"#;
	///
	/// let mut writer = EventWriter::new(Vec::new());
	/// author.write(&mut writer).unwrap();
	/// let result = String::from_utf8(writer.into_inner()).unwrap();
	///
	/// assert_eq!(result, xml_str);
	/// ```
	pub fn write(&self, writer: &mut EventWriter<Vec<u8>>) -> CoreResult<()> {
		writer.write(xml::writer::XmlEvent::start_element("author"))?;
		util::write_xml_element("name", &self.name, writer)?;

		if let Some(uri) = &self.uri {
			util::write_xml_element("uri", uri, writer)?;
		}

		writer.write(xml::writer::XmlEvent::end_element())?; // end of author

		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::opds::v1_2::tests::normalize_xml;

	#[test]
	fn test_author_with_only_name() {
		let author = LongboxAuthor::new("Longbox".to_string(), None);

		let mut writer = EventWriter::new(Vec::new());
		author.write(&mut writer).unwrap();

		let result = String::from_utf8(writer.into_inner()).unwrap();
		let expected_result = normalize_xml(
			r#"
			<?xml version="1.0" encoding="UTF-8"?>
			<author>
				<name>Longbox</name>
			</author>
			"#,
		);

		assert_eq!(result, expected_result);
	}

	#[test]
	fn test_author_with_name_and_uri() {
		let author = LongboxAuthor::new(
			"Longbox".to_string(),
			Some("https://www.stumpapp.dev/".to_string()),
		);

		let mut writer = EventWriter::new(Vec::new());
		author.write(&mut writer).unwrap();

		let result = String::from_utf8(writer.into_inner()).unwrap();
		let expected_result = normalize_xml(
			r#"
			<?xml version="1.0" encoding="UTF-8"?>
			<author>
				<name>Longbox</name>
				<uri>https://www.stumpapp.dev/</uri>
			</author>
			"#,
		);

		assert_eq!(result, expected_result);
	}
}
