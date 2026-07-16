//! Live smoke test for the Metron provider against a real comic.
//!
//! Reads `METRON_CREDENTIALS` (`username:password`) from the environment, validates
//! the credentials, then runs an issue search. Usage:
//!
//! ```sh
//! METRON_CREDENTIALS="user:pass" \
//!   cargo run -p metadata_integrations --example metron_lookup -- "Absolute Batman" 1 2024
//! ```
//!
//! Args: <series name> [issue number] [series year]. Hits the live API — mind the
//! 20/min, 5,000/day limits.

use metadata_integrations::{
	create_provider, ExternalMetadata, MatchCandidate, ProviderValidationStatus,
	SearchQuery,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	let creds = std::env::var("METRON_CREDENTIALS")
		.map_err(|_| "set METRON_CREDENTIALS=username:password")?;

	let mut args = std::env::args().skip(1);
	let series = args.next().unwrap_or_else(|| "Absolute Batman".to_string());
	let number = args.next().unwrap_or_else(|| "1".to_string());
	let year: Option<i32> = args.next().and_then(|y| y.parse().ok());

	let provider = create_provider("METRON", creds)?;

	println!("== Metron provider smoke test ==");
	println!("query: series={series:?} number={number:?} year={year:?}\n");

	// 1. Credential validation (exercises validate_credentials + the User-Agent fix)
	let validation = provider.validate_credentials().await?;
	println!("[validate_credentials]");
	println!("  status : {:?}", validation.status);
	println!("  message: {}\n", validation.message);

	if validation.status != ProviderValidationStatus::Valid {
		println!(
			"Skipping search — provider is not reachable/valid ({:?}).",
			validation.status
		);
		return Ok(());
	}

	// 2. Issue search for the comic
	let query = SearchQuery {
		title: series.clone(),
		series_name: Some(series),
		number: Some(number),
		series_year: year,
		limit: Some(5),
		..Default::default()
	};

	let candidates = provider.search_media(&query).await?;
	println!("[search_media] {} candidate(s):", candidates.len());
	for (i, candidate) in candidates.iter().enumerate() {
		print_candidate(i + 1, candidate);
	}

	Ok(())
}

fn print_candidate(rank: usize, candidate: &MatchCandidate) {
	let ExternalMetadata::Media(m) = &candidate.metadata else {
		println!("  #{rank} (non-media result)");
		return;
	};

	let title = m.title.as_deref().unwrap_or("<no story title>");
	let series = m.series_name.as_deref().unwrap_or("<unknown series>");
	let number = m
		.number
		.map(|n| format!("#{n}"))
		.unwrap_or_else(|| "#?".to_string());
	let year = m.year.map(|y| y.to_string()).unwrap_or_default();
	let publisher = m.publisher.as_deref().unwrap_or("?");

	println!(
		"\n  #{rank}  confidence={:.2}  [metron id {}]",
		candidate.confidence, m.external_id
	);
	println!("      {series} {number} ({year}) — {title}");
	println!("      publisher: {publisher}");
	if let Some(writers) = &m.writers {
		println!("      writers  : {}", writers.join(", "));
	}
	if let Some(url) = &m.provider_url {
		println!("      url      : {url}");
	}
	if let Some(cover) = &m.cover_url {
		println!("      cover    : {cover}");
	}
}
