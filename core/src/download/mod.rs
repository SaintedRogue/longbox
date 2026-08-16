//! Fetching what the queue has been asked to fetch.
//!
//! Longbox performs downloads itself rather than letting a plugin hand over a finished
//! file. That keeps progress, cancellation, retries, size limits and atomic placement in
//! one implementation instead of one per plugin, and it keeps a plugin small enough to be
//! worth writing: a plugin says *where* a file is, and nothing more.
//!
//! Nothing is ever written directly into a library. A download lands in a staging
//! directory under the config dir, and only a complete file is moved into place — a
//! half-written file appearing in a watched folder would be picked up as a book.

pub mod sweep;

use std::path::{Path, PathBuf};

use models::entity::{download_queue, series};
use sea_orm::{prelude::*, ActiveValue::Set, QueryFilter};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::{
	job::{error::JobError, JobContext, JobLifecycle, JobTaskOutput, WorkingState},
	plugin::resolve_download,
};

/// Directory under the config dir where partial downloads live.
pub const STAGING_DIR: &str = "downloads";

/// How much has to arrive before progress is written back.
///
/// Per-chunk writes would mean thousands of updates for one file, all of them contending
/// with everything else on a single SQLite connection. A megabyte is often enough for a
/// progress bar to move smoothly and rare enough to be free.
const PROGRESS_UPDATE_BYTES: u64 = 1024 * 1024;

/// Ceiling on a single download.
///
/// A stand-in for a real free-space check, which SQLite-adjacent Rust has no portable way
/// to do without another dependency. It bounds the damage a mis-resolved URL can cause;
/// the honest fix is a free-space check, and this is not it.
const MAX_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// How many redirects a download may follow.
///
/// Followed by hand rather than by reqwest, because each hop has to be re-validated: an
/// allowed first URL that redirects to `127.0.0.1` is exactly the bypass a single up-front
/// check would miss.
const MAX_REDIRECTS: usize = 5;

pub fn staging_root(config_dir: &Path) -> PathBuf {
	config_dir.join(STAGING_DIR)
}

/// Whether an address belongs to the server's own machine or private network.
///
/// A `resolve` response is plugin-supplied, and a *remote* plugin is only a URL the
/// operator registered — it has no other access to this host. Without this check it could
/// aim Longbox at loopback, at RFC1918 neighbours, or at a cloud metadata endpoint, and
/// have the server make that request from inside the network on its behalf. A local plugin
/// already runs arbitrary commands here, so this is not aimed at that case; it is aimed at
/// the one where the plugin genuinely has no foothold and should not gain one.
fn is_forbidden_ip(addr: std::net::IpAddr) -> bool {
	use std::net::IpAddr;

	match addr {
		IpAddr::V4(ip) => {
			ip.is_loopback()
				|| ip.is_private()
				|| ip.is_link_local()
				|| ip.is_multicast()
				|| ip.is_broadcast()
				|| ip.is_unspecified()
				|| ip.is_documentation()
				// 100.64.0.0/10, carrier-grade NAT — routable-looking but not public.
				|| (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
				// 0.0.0.0/8
				|| ip.octets()[0] == 0
		},
		IpAddr::V6(ip) => {
			// An IPv4-mapped address has to be judged as the IPv4 address it carries,
			// or ::ffff:127.0.0.1 walks straight past every check above.
			if let Some(mapped) = ip.to_ipv4_mapped() {
				return is_forbidden_ip(IpAddr::V4(mapped));
			}
			ip.is_loopback()
				|| ip.is_multicast()
				|| ip.is_unspecified()
				// fc00::/7 unique-local
				|| (ip.segments()[0] & 0xfe00) == 0xfc00
				// fe80::/10 link-local
				|| (ip.segments()[0] & 0xffc0) == 0xfe80
		},
	}
}

/// Check a download URL is one this server is willing to fetch.
///
/// Note the residual gap this does not close: the host is resolved here and connected to
/// moments later, so a name that answers differently between the two (DNS rebinding) is
/// still possible. Closing it properly means connecting to the validated address directly
/// and carrying the hostname for TLS, which reqwest does not make available. This raises
/// the bar from "any plugin can address the internal network" to "a plugin must win a race
/// against its own DNS", and the remaining risk is recorded rather than hidden.
async fn assert_fetchable(raw: &str) -> Result<url::Url, JobError> {
	let parsed = url::Url::parse(raw).map_err(|e| {
		JobError::TaskFailed(format!("Plugin returned an unusable URL: {e}"))
	})?;

	if !matches!(parsed.scheme(), "http" | "https") {
		return Err(JobError::TaskFailed(format!(
			"Refusing to fetch a {} URL; only http and https are allowed",
			parsed.scheme()
		)));
	}

	let host = parsed
		.host_str()
		.ok_or_else(|| JobError::TaskFailed("Download URL has no host".to_string()))?;
	let port = parsed.port_or_known_default().unwrap_or(80);

	let addresses: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
		.await
		.map_err(|e| JobError::TaskFailed(format!("Cannot resolve {host}: {e}")))?
		.collect();

	if addresses.is_empty() {
		return Err(JobError::TaskFailed(format!("{host} resolved to nothing")));
	}
	// Every address, not merely the first: a name resolving to one public and one private
	// address must not be fetchable on the strength of whichever came back first.
	if let Some(bad) = addresses.iter().find(|a| is_forbidden_ip(a.ip())) {
		return Err(JobError::TaskFailed(format!(
			"Refusing to fetch {host}: it resolves to {}, which is on this server's own network",
			bad.ip()
		)));
	}

	Ok(parsed)
}

/// Reduce a plugin-supplied filename to something safe to join onto a directory.
///
/// The name arrives from a plugin, which means it arrives from whatever that plugin was
/// talking to. `../../etc/cron.d/x` must become a filename, not a path — so every
/// separator and every traversal component is discarded rather than escaped, and the
/// result is always exactly one path component.
pub fn sanitize_filename(raw: &str) -> String {
	let trimmed = raw.trim();
	// Take only the final component, then strip anything that could still be structural.
	let base = trimmed
		.rsplit(['/', '\\'])
		.next()
		.unwrap_or("")
		.replace('\0', "");
	let cleaned: String = base
		.chars()
		.filter(|c| !matches!(c, '\\' | '/' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
		.collect();
	let cleaned = cleaned.trim().trim_matches('.').to_string();

	if cleaned.is_empty() {
		"download.bin".to_string()
	} else {
		cleaned
	}
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
pub struct DownloadQueueOutput {
	pub completed: usize,
	pub failed: usize,
	pub bytes: u64,
}

impl crate::job::JobOutputExt for DownloadQueueOutput {
	fn update(&mut self, updated: Self) {
		self.completed += updated.completed;
		self.failed += updated.failed;
		self.bytes += updated.bytes;
	}
}

/// Drain the approved part of the download queue.
///
/// One job for the whole queue rather than one per file: the queue is the unit an operator
/// thinks about, and it keeps the number of concurrent transfers bounded by how many of
/// these run rather than by how many rows exist.
pub struct DownloadQueueJob;

#[async_trait::async_trait]
impl JobLifecycle for DownloadQueueJob {
	const NAME: &'static str = "download_queue";

	type Output = DownloadQueueOutput;
	/// A queue row id. Deliberately not the row itself: by the time a task runs, the row
	/// may have been cancelled, and it has to be re-read to notice.
	type Task = i32;

	fn description(&self) -> Option<String> {
		Some("Fetch approved downloads".to_string())
	}

	async fn init(
		&mut self,
		ctx: &JobContext,
	) -> Result<WorkingState<Self::Output, Self::Task>, JobError> {
		let conn = ctx.apalis_state.conn.as_ref();

		let tasks: Vec<i32> = download_queue::Entity::find()
			.filter(
				download_queue::Column::Status
					.eq(download_queue::DownloadStatus::Approved.as_str()),
			)
			.all(conn)
			.await
			.map_err(|e| JobError::InitFailed(e.to_string()))?
			.into_iter()
			.map(|row| row.id)
			.collect();

		Ok(WorkingState {
			output: Some(Self::Output::default()),
			tasks: tasks.into(),
			logs: vec![],
		})
	}

	async fn execute_task(
		&self,
		ctx: &JobContext,
		task: Self::Task,
	) -> Result<JobTaskOutput<Self>, JobError> {
		let mut output = Self::Output::default();
		let conn = ctx.apalis_state.conn.as_ref();

		// Re-read rather than trusting what init collected: a row can be cancelled between
		// being queued for this job and being reached by it, and honouring that is the
		// whole point of having a cancel action.
		let Some(row) = download_queue::Entity::find_by_id(task)
			.one(conn)
			.await
			.map_err(|e| JobError::TaskFailed(e.to_string()))?
		else {
			return Ok(JobTaskOutput {
				output,
				subtasks: vec![],
				logs: vec![],
			});
		};

		if row.download_status() != Some(download_queue::DownloadStatus::Approved) {
			return Ok(JobTaskOutput {
				output,
				subtasks: vec![],
				logs: vec![],
			});
		}

		match download_one(ctx, &row).await {
			Ok(bytes) => {
				output.completed += 1;
				output.bytes += bytes;
			},
			Err(error) => {
				output.failed += 1;
				tracing::error!(queue_id = row.id, %error, "Download failed");
				let _ = mark(
					conn,
					row.id,
					download_queue::DownloadStatus::Failed,
					Some(error.to_string()),
				)
				.await;
			},
		}

		Ok(JobTaskOutput {
			output,
			subtasks: vec![],
			logs: vec![],
		})
	}
}

/// Set a row's status, and its error when there is one.
async fn mark(
	conn: &DatabaseConnection,
	id: i32,
	status: download_queue::DownloadStatus,
	error: Option<String>,
) -> Result<(), DbErr> {
	download_queue::ActiveModel {
		id: sea_orm::ActiveValue::Unchanged(id),
		status: Set(status.as_str().to_string()),
		error: Set(error),
		updated_at: Set(Some(chrono::Utc::now().into())),
		..Default::default()
	}
	.update(conn)
	.await?;
	Ok(())
}

/// Fetch one queued file: resolve it, stream it to staging, then place it.
async fn download_one(
	ctx: &JobContext,
	row: &download_queue::Model,
) -> Result<u64, JobError> {
	let conn = ctx.apalis_state.conn.as_ref();
	let config_dir = ctx.apalis_state.config.get_config_dir();

	mark(
		conn,
		row.id,
		download_queue::DownloadStatus::Downloading,
		None,
	)
	.await
	.map_err(|e| JobError::TaskFailed(e.to_string()))?;

	// Resolved now rather than at search time: a resolved address is frequently
	// single-use or short-lived, so it is obtained immediately before it is used.
	let resolved = resolve_download(conn, &row.plugin_slug, &row.download_id)
		.await
		.map_err(|e| JobError::TaskFailed(e.to_string()))?;

	let staging = staging_root(&config_dir);
	tokio::fs::create_dir_all(&staging)
		.await
		.map_err(|e| JobError::TaskFailed(format!("Cannot create staging dir: {e}")))?;

	let filename = sanitize_filename(
		resolved
			.response
			.filename
			.as_deref()
			.unwrap_or(row.title.as_str()),
	);
	// The partial carries the row id, so two downloads that resolve to the same filename
	// cannot write over each other while in flight.
	let partial = staging.join(format!("{}.{}.part", row.id, filename));

	let bytes = stream_to_file(ctx, row, &resolved, &partial)
		.await
		.inspect_err(|_| {
			// A partial file is never useful and always occupies the disk.
			let path = partial.clone();
			tokio::spawn(async move {
				let _ = tokio::fs::remove_file(path).await;
			});
		})?;

	let destination = place_file(conn, row, &staging, &filename, &partial).await?;

	download_queue::ActiveModel {
		id: sea_orm::ActiveValue::Unchanged(row.id),
		status: Set(download_queue::DownloadStatus::Completed
			.as_str()
			.to_string()),
		progress_bytes: Set(bytes as i64),
		staging_path: Set(Some(destination.to_string_lossy().to_string())),
		error: Set(None),
		updated_at: Set(Some(chrono::Utc::now().into())),
		..Default::default()
	}
	.update(conn)
	.await
	.map_err(|e| JobError::TaskFailed(e.to_string()))?;

	tracing::info!(
		queue_id = row.id,
		bytes,
		destination = %destination.display(),
		"Download complete"
	);
	Ok(bytes)
}

/// Stream the body to `target`, honouring cancellation and the size ceiling.
/// Obtain the body, whichever way the plugin said to get it.
///
/// Two modes, and the difference that matters is *who chose the address*. A URL comes from
/// the plugin and is therefore checked against [`assert_fetchable`]. A streamed fetch goes
/// to the plugin's own registered endpoint — an address Longbox assigned, and for a local
/// plugin deliberately loopback — so the same check would reject the one destination that
/// is by definition not the plugin's choice. Applying it there would ban the safe case and
/// protect nothing.
async fn open_source(
	resolved: &crate::plugin::ResolvedDownload,
) -> Result<reqwest::Response, JobError> {
	if resolved.response.stream {
		return resolved
			.client
			.fetch_stream(&resolved.request)
			.await
			.map_err(|e| {
				JobError::TaskFailed(format!("Plugin could not serve it: {e}"))
			});
	}

	let url = resolved.response.url.clone().ok_or_else(|| {
		JobError::TaskFailed(
			"Plugin resolved to neither a URL nor a stream; there is nothing to fetch"
				.to_string(),
		)
	})?;

	// Redirects are disabled and followed by hand, because reqwest's own policy runs
	// without a chance to re-resolve each hop: an allowed URL that redirects to loopback
	// would otherwise sail past a single up-front check.
	let client = reqwest::Client::builder()
		.redirect(reqwest::redirect::Policy::none())
		.build()
		.map_err(|e| JobError::TaskFailed(format!("Cannot build HTTP client: {e}")))?;

	let mut target_url = url;

	for _ in 0..=MAX_REDIRECTS {
		let validated = assert_fetchable(&target_url).await?;

		let mut request = client.get(validated.clone());
		for (name, value) in &resolved.response.headers {
			// `Host` would let a plugin address one machine while claiming to be talking
			// to another, which is exactly what the address check above is there to stop.
			if name.eq_ignore_ascii_case("host") {
				continue;
			}
			request = request.header(name, value);
		}

		let attempt = request
			.send()
			.await
			.map_err(|e| JobError::TaskFailed(format!("Request failed: {e}")))?;

		if attempt.status().is_redirection() {
			let location = attempt
				.headers()
				.get(reqwest::header::LOCATION)
				.and_then(|v| v.to_str().ok())
				.ok_or_else(|| {
					JobError::TaskFailed("Redirect without a location".to_string())
				})?;
			// Resolved against the current URL so a relative redirect works.
			target_url = validated
				.join(location)
				.map_err(|e| {
					JobError::TaskFailed(format!("Unusable redirect target: {e}"))
				})?
				.to_string();
			continue;
		}

		if !attempt.status().is_success() {
			return Err(JobError::TaskFailed(format!(
				"Source answered {}",
				attempt.status()
			)));
		}

		return Ok(attempt);
	}

	Err(JobError::TaskFailed(format!(
		"Gave up after {MAX_REDIRECTS} redirects"
	)))
}

/// Write a body to `target`, honouring cancellation and the size ceiling.
///
/// Shared by both resolve modes on purpose: whatever produced the bytes, the queue's
/// guarantees about progress, cancellation and disk usage are the same.
async fn stream_to_file(
	ctx: &JobContext,
	row: &download_queue::Model,
	resolved: &crate::plugin::ResolvedDownload,
	target: &Path,
) -> Result<u64, JobError> {
	let conn = ctx.apalis_state.conn.as_ref();

	let mut response = open_source(resolved).await?;
	let mut file = tokio::fs::File::create(target).await.map_err(|e| {
		JobError::TaskFailed(format!("Cannot open {}: {e}", target.display()))
	})?;

	let mut written: u64 = 0;
	let mut since_update: u64 = 0;

	// `chunk()` rather than a `Stream`: the workspace builds reqwest without the `stream`
	// feature, which pulls in a conflicting `js-sys`.
	loop {
		if ctx.cancel_token.is_cancelled() {
			let _ = mark(
				conn,
				row.id,
				download_queue::DownloadStatus::Cancelled,
				None,
			)
			.await;
			return Err(JobError::TaskFailed("Cancelled".to_string()));
		}

		let chunk = response
			.chunk()
			.await
			.map_err(|e| JobError::TaskFailed(format!("Transfer failed: {e}")))?;
		let Some(chunk) = chunk else { break };

		written += chunk.len() as u64;
		if written > MAX_DOWNLOAD_BYTES {
			return Err(JobError::TaskFailed(format!(
				"Exceeded the {MAX_DOWNLOAD_BYTES} byte ceiling for a single download"
			)));
		}

		file.write_all(&chunk)
			.await
			.map_err(|e| JobError::TaskFailed(format!("Write failed: {e}")))?;

		since_update += chunk.len() as u64;
		if since_update >= PROGRESS_UPDATE_BYTES {
			since_update = 0;
			let _ = download_queue::ActiveModel {
				id: sea_orm::ActiveValue::Unchanged(row.id),
				progress_bytes: Set(written as i64),
				..Default::default()
			}
			.update(conn)
			.await;
		}
	}

	file.flush()
		.await
		.map_err(|e| JobError::TaskFailed(format!("Flush failed: {e}")))?;
	Ok(written)
}

/// Move a finished file out of staging and into the series it was wanted for.
///
/// Only ever a rename of a *complete* file, so nothing watching a library can observe a
/// partially written book. A download with no series stays in staging: there is nowhere
/// obviously correct to put it, and inventing one would scatter files.
async fn place_file(
	conn: &DatabaseConnection,
	row: &download_queue::Model,
	staging: &Path,
	filename: &str,
	partial: &Path,
) -> Result<PathBuf, JobError> {
	let series_path = match &row.series_id {
		Some(id) => series::Entity::find_by_id(id.clone())
			.one(conn)
			.await
			.map_err(|e| JobError::TaskFailed(e.to_string()))?
			.map(|s| PathBuf::from(s.path)),
		None => None,
	};

	let destination = match series_path {
		Some(dir) if dir.is_dir() => dir.join(filename),
		// Either no series, or its directory is not there any more. Staging is a defensible
		// place to leave a finished file; a guessed one is not.
		_ => staging.join(filename),
	};

	move_into_place(partial, &destination).await?;

	Ok(destination)
}

/// Move a finished file into place, across filesystems if it has to.
///
/// `rename` is the fast path and the only genuinely atomic one, but it fails with `EXDEV`
/// the moment the two paths are on different filesystems — which here is not an edge case
/// but the *normal* arrangement: `/config` and `/data` are separate Docker volumes, so
/// staging and the library are essentially never on the same device in a real deployment.
/// This was found by a live run; every unit test passed because a temp directory and its
/// target were the same filesystem.
///
/// Copying straight to the destination would fix that and quietly give up the property the
/// staging directory exists for, since a watcher would see a file growing in the library.
/// So the copy goes to a temporary name *inside the destination directory* and is renamed
/// from there: that final step is same-filesystem, and therefore still atomic.
async fn move_into_place(from: &Path, to: &Path) -> Result<(), JobError> {
	if tokio::fs::rename(from, to).await.is_ok() {
		return Ok(());
	}

	let staged_name = format!(
		".{}.incoming",
		to.file_name()
			.and_then(|n| n.to_str())
			.unwrap_or("download")
	);
	let staged = to.with_file_name(staged_name);

	let copied = tokio::fs::copy(from, &staged).await;
	if let Err(error) = copied {
		let _ = tokio::fs::remove_file(&staged).await;
		return Err(JobError::TaskFailed(format!(
			"Cannot copy into {}: {error}",
			to.display()
		)));
	}

	if let Err(error) = tokio::fs::rename(&staged, to).await {
		let _ = tokio::fs::remove_file(&staged).await;
		return Err(JobError::TaskFailed(format!(
			"Cannot place {}: {error}",
			to.display()
		)));
	}

	// Only once the destination is safely in place — losing the source before that would
	// mean a failed move had also destroyed the download.
	let _ = tokio::fs::remove_file(from).await;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The case this exists for: the name comes from a plugin, which got it from whatever
	/// it was scraping. It must reduce to a filename, never a path.
	#[test]
	fn a_traversing_filename_is_reduced_to_one_component() {
		for raw in [
			"../../etc/cron.d/x",
			"/etc/passwd",
			"..\\..\\windows\\system32\\x",
		] {
			let safe = sanitize_filename(raw);
			assert!(!safe.contains('/'), "{raw} -> {safe}");
			assert!(!safe.contains('\\'), "{raw} -> {safe}");
			assert!(!safe.starts_with('.'), "{raw} -> {safe}");
		}
	}

	#[test]
	fn an_ordinary_name_survives() {
		assert_eq!(
			sanitize_filename("Absolute Batman 007 (2026).cbz"),
			"Absolute Batman 007 (2026).cbz"
		);
	}

	/// A name that sanitises to nothing still has to produce a usable file.
	#[test]
	fn an_empty_or_hostile_name_falls_back() {
		assert_eq!(sanitize_filename("   "), "download.bin");
		assert_eq!(sanitize_filename("../.."), "download.bin");
		assert_eq!(sanitize_filename("/"), "download.bin");
	}

	fn ip(raw: &str) -> std::net::IpAddr {
		raw.parse().expect("test address parses")
	}

	/// The addresses a plugin must not be able to point this server at.
	#[test]
	fn addresses_on_our_own_network_are_refused() {
		for raw in [
			"127.0.0.1",
			"10.0.0.214",
			"192.168.1.1",
			"172.16.5.4",
			// Cloud metadata, the classic SSRF destination.
			"169.254.169.254",
			"0.0.0.0",
			"255.255.255.255",
			"224.0.0.1",
			"100.64.0.1",
			"::1",
			"fe80::1",
			"fd00::1",
			"::",
		] {
			assert!(is_forbidden_ip(ip(raw)), "{raw} should be refused");
		}
	}

	/// The bypass worth naming: an IPv4-mapped IPv6 address carries a v4 address that the
	/// v6 checks would otherwise never look at.
	#[test]
	fn ipv4_mapped_loopback_is_judged_as_ipv4() {
		assert!(is_forbidden_ip(ip("::ffff:127.0.0.1")));
		assert!(is_forbidden_ip(ip("::ffff:10.1.2.3")));
		assert!(!is_forbidden_ip(ip("::ffff:93.184.216.34")));
	}

	#[test]
	fn ordinary_public_addresses_are_allowed() {
		for raw in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
			assert!(!is_forbidden_ip(ip(raw)), "{raw} should be allowed");
		}
	}

	#[tokio::test]
	async fn non_http_schemes_are_refused() {
		for raw in ["file:///etc/passwd", "ftp://example.com/x", "gopher://x/1"] {
			let error = assert_fetchable(raw).await.unwrap_err();
			assert!(
				error.to_string().contains("only http and https"),
				"{raw} -> {error}"
			);
		}
	}

	#[tokio::test]
	async fn a_loopback_url_is_refused_before_any_request_is_made() {
		let error = assert_fetchable("http://127.0.0.1:10801/api/graphql")
			.await
			.unwrap_err();
		assert!(error.to_string().contains("own network"), "got: {error}");
	}

	/// Same-filesystem is the fast path and must stay a plain rename, leaving nothing
	/// behind. The cross-device fallback cannot be unit tested without two real
	/// filesystems, which is exactly why it took a live run to find.
	#[tokio::test]
	async fn a_finished_file_moves_into_place_and_leaves_no_residue() {
		let dir = tempfile::tempdir().unwrap();
		let from = dir.path().join("1.book.cbz.part");
		let to = dir.path().join("book.cbz");
		tokio::fs::write(&from, b"payload").await.unwrap();

		move_into_place(&from, &to).await.expect("moves");

		assert_eq!(tokio::fs::read(&to).await.unwrap(), b"payload");
		assert!(!from.exists(), "the partial must not survive the move");
		let leftovers: Vec<_> = std::fs::read_dir(dir.path())
			.unwrap()
			.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
			.filter(|n| n != "book.cbz")
			.collect();
		assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
	}

	#[test]
	fn staging_lives_under_the_config_dir() {
		let root = staging_root(Path::new("/config"));
		assert_eq!(root, PathBuf::from("/config/downloads"));
	}
}
