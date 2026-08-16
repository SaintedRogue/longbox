//! Plugins that live in a directory here and are run by Longbox itself.
//!
//! A local plugin is the same v1 protocol service a remote plugin is — it serves
//! `/manifest`, `/health` and its capability endpoints exactly as before. The only
//! difference is that Longbox starts the process and picks the address, which means
//! everything downstream (capability discovery, the config form, the token, the sweeps)
//! never learns there are two kinds. That is what keeps this an addition rather than a
//! second plugin system.
//!
//! **Trust boundary.** Launching a local plugin runs operator-supplied code inside the
//! server's container, with the server's privileges. That is what installing a plugin
//! means, but it is not something to do implicitly: a freshly installed plugin stays
//! disabled until the operator turns it on, exactly as a remote one does, and the command
//! that will be run is shown before it ever is.

use std::{
	collections::HashMap,
	path::{Path, PathBuf},
	process::Stdio,
	sync::Arc,
	time::Duration,
};

use plugin_integrations::PluginClient;
use serde::{Deserialize, Serialize};
use tokio::{
	io::{AsyncBufReadExt, BufReader},
	net::TcpListener,
	process::{Child, Command},
	sync::Mutex,
};

use crate::{CoreError, CoreResult};

/// Directory under the config dir holding every installed plugin.
pub const PLUGINS_DIR: &str = "plugins";
/// The descriptor every installed plugin directory must contain.
pub const DESCRIPTOR_FILE: &str = "plugin.json";

/// How long a freshly launched plugin has to answer `/health` before we give up on it.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
/// Gap between health polls while waiting for startup.
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// `plugin.json` at the root of an installed plugin directory.
///
/// Deliberately tiny: it says how to *start* the plugin and nothing else. Everything about
/// what the plugin can do still comes from the manifest it serves once running, so a
/// descriptor cannot lie about capabilities and there is only one source of truth.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocalPluginDescriptor {
	/// The manifest id this directory claims to provide. Cross-checked against what the
	/// running process actually serves, so a directory cannot be swapped underneath a
	/// registration and inherit its identity and settings.
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub version: Option<String>,
	#[serde(default)]
	pub description: Option<String>,
	/// argv. The first element is resolved against the plugin's own directory, and must
	/// stay inside it — see [`resolve_program`].
	pub command: Vec<String>,
	/// Path prefix if the plugin serves the protocol somewhere other than the root.
	#[serde(default)]
	pub base_path: Option<String>,
}

impl LocalPluginDescriptor {
	pub fn read(dir: &Path) -> CoreResult<Self> {
		let path = dir.join(DESCRIPTOR_FILE);
		let raw = std::fs::read_to_string(&path).map_err(|e| {
			CoreError::InternalError(format!(
				"Plugin at {} has no readable {DESCRIPTOR_FILE}: {e}",
				dir.display()
			))
		})?;
		let descriptor: Self = serde_json::from_str(&raw).map_err(|e| {
			CoreError::InternalError(format!("{} is not valid JSON: {e}", path.display()))
		})?;

		if descriptor.command.is_empty() {
			return Err(CoreError::InternalError(format!(
				"{} declares no command to run",
				path.display()
			)));
		}
		Ok(descriptor)
	}
}

/// The root every installed plugin lives under.
pub fn plugins_root(config_dir: &Path) -> PathBuf {
	config_dir.join(PLUGINS_DIR)
}

/// A plugin directory found on disk, whether or not it has been registered.
pub struct DiscoveredPlugin {
	/// Directory name under the plugins root — the handle used to install it.
	pub dir: String,
	pub descriptor: LocalPluginDescriptor,
}

/// Every readable plugin directory under the plugins root.
///
/// This is how a plugin gets here without a catalogue: drop a directory into
/// `{config}/plugins` over whatever share the config volume already exposes, and it shows
/// up to be installed. A directory that is missing or malformed is skipped with a warning
/// rather than failing the scan — one broken plugin must not hide the rest.
pub fn discover(config_dir: &Path) -> Vec<DiscoveredPlugin> {
	let root = plugins_root(config_dir);
	let Ok(entries) = std::fs::read_dir(&root) else {
		// No plugins directory at all is the normal case, not a problem worth logging.
		return Vec::new();
	};

	let mut found = Vec::new();
	for entry in entries.flatten() {
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}
		let Some(dir) = entry.file_name().to_str().map(String::from) else {
			continue;
		};

		match LocalPluginDescriptor::read(&path) {
			Ok(descriptor) => found.push(DiscoveredPlugin { dir, descriptor }),
			Err(error) => {
				tracing::warn!(directory = %dir, %error, "Skipping unreadable plugin directory")
			},
		}
	}

	found.sort_by(|a, b| a.dir.cmp(&b.dir));
	found
}

/// Resolve a descriptor's program to an absolute path inside its own directory.
///
/// A descriptor is a file in the config directory, so it is already operator-controlled —
/// but it may also have arrived inside a downloaded archive, and a program path of
/// `../../../bin/sh` in that archive should not be how someone reaches the rest of the
/// filesystem. A bare name with no separator (`node`, `sh`) is left alone for `PATH`
/// lookup; anything path-shaped is resolved against the plugin directory and must remain
/// under it after canonicalisation.
pub fn resolve_program(dir: &Path, program: &str) -> CoreResult<PathBuf> {
	if !program.contains('/') && !program.contains('\\') {
		return Ok(PathBuf::from(program));
	}

	let candidate = dir.join(program);
	let resolved = candidate.canonicalize().map_err(|e| {
		CoreError::InternalError(format!("Cannot resolve {}: {e}", candidate.display()))
	})?;
	let root = dir.canonicalize().map_err(|e| {
		CoreError::InternalError(format!("Cannot resolve {}: {e}", dir.display()))
	})?;

	if !resolved.starts_with(&root) {
		return Err(CoreError::InternalError(format!(
			"Plugin command {program} resolves outside its own directory; refusing to run it"
		)));
	}
	Ok(resolved)
}

/// Ask the OS for a free loopback port by binding one and immediately releasing it.
///
/// There is a race here in principle — something else could take the port between release
/// and the child binding it — but the alternative is a protocol where the child reports its
/// own port back, which means a second channel and a much larger change. A collision
/// surfaces as a startup failure with a legible reason and is fixed by trying again.
async fn free_loopback_port() -> CoreResult<u16> {
	let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| {
		CoreError::InternalError(format!("Could not reserve a port for a plugin: {e}"))
	})?;
	let port = listener
		.local_addr()
		.map_err(|e| {
			CoreError::InternalError(format!("Reserved port is unreadable: {e}"))
		})?
		.port();
	drop(listener);
	Ok(port)
}

/// A launched plugin process and where it answers.
pub struct RunningPlugin {
	pub base_url: String,
	child: Child,
}

impl RunningPlugin {
	/// Terminate the process. Best-effort: a plugin that has already exited is not an error.
	pub async fn stop(&mut self) {
		let _ = self.child.start_kill();
		let _ = self.child.wait().await;
	}
}

/// Every local plugin Longbox currently has running, keyed by slug.
///
/// Held on `Ctx` so the set has exactly one owner. Nothing here restarts a plugin on its
/// own: a crashed plugin is reported and left down, because a plugin that fails on startup
/// would otherwise be relaunched forever and fill the log with the same error.
#[derive(Default)]
pub struct PluginProcesses {
	running: Mutex<HashMap<String, RunningPlugin>>,
}

impl PluginProcesses {
	pub fn new() -> Arc<Self> {
		Arc::new(Self::default())
	}

	pub async fn is_running(&self, slug: &str) -> bool {
		self.running.lock().await.contains_key(slug)
	}

	pub async fn base_url(&self, slug: &str) -> Option<String> {
		self.running
			.lock()
			.await
			.get(slug)
			.map(|p| p.base_url.clone())
	}

	/// Launch a plugin directory and wait for it to answer `/health`.
	///
	/// Returns the base URL it is answering on, which the caller stores so the settings UI
	/// can show it. Starting one that is already running stops the old process first, so
	/// this doubles as restart and cannot leak a child.
	pub async fn start(
		&self,
		slug: &str,
		dir: &Path,
		descriptor: &LocalPluginDescriptor,
		token: Option<&str>,
	) -> CoreResult<String> {
		self.stop(slug).await;

		let program = resolve_program(dir, &descriptor.command[0])?;
		let port = free_loopback_port().await?;

		let mut command = Command::new(&program);
		command
			.args(&descriptor.command[1..])
			.current_dir(dir)
			.env("LONGBOX_PLUGIN_PORT", port.to_string())
			// `PORT` as well as the namespaced name: it is the near-universal convention
			// for "listen here", so a plugin written against any HTTP framework's defaults
			// binds correctly without having to know anything Longbox-specific.
			.env("PORT", port.to_string())
			.env("LONGBOX_PLUGIN_DIR", dir)
			.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			// Without this a plugin keeps running after Longbox exits, and the next boot
			// finds its port taken by an orphan it has no handle on.
			.kill_on_drop(true);

		if let Some(token) = token {
			command.env("LONGBOX_PLUGIN_TOKEN", token);
		}

		let mut child = command.spawn().map_err(|e| {
			CoreError::InternalError(format!(
				"Could not start plugin {slug} ({}): {e}",
				program.display()
			))
		})?;

		// A plugin's own output is the only diagnostic when it fails to start, so it is
		// forwarded rather than discarded. Tagged with the slug so several are separable.
		if let Some(stdout) = child.stdout.take() {
			forward_output(slug.to_string(), stdout, false);
		}
		if let Some(stderr) = child.stderr.take() {
			forward_output(slug.to_string(), stderr, true);
		}

		let base_path = descriptor.base_path.as_deref().unwrap_or("");
		let base_url = format!("http://127.0.0.1:{port}{base_path}");

		let mut running = RunningPlugin {
			base_url: base_url.clone(),
			child,
		};

		if let Err(error) = await_health(&base_url, token, &mut running.child).await {
			running.stop().await;
			return Err(error);
		}

		self.running.lock().await.insert(slug.to_string(), running);
		Ok(base_url)
	}

	pub async fn stop(&self, slug: &str) {
		if let Some(mut running) = self.running.lock().await.remove(slug) {
			running.stop().await;
			tracing::info!(plugin = slug, "Stopped local plugin");
		}
	}

	/// Stop everything, for shutdown.
	pub async fn stop_all(&self) {
		let mut running = self.running.lock().await;
		for (slug, plugin) in running.iter_mut() {
			plugin.stop().await;
			tracing::info!(plugin = %slug, "Stopped local plugin");
		}
		running.clear();
	}
}

/// Pipe a child's output into our own logs, one line at a time.
fn forward_output<R>(slug: String, reader: R, is_stderr: bool)
where
	R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
	tokio::spawn(async move {
		let mut lines = BufReader::new(reader).lines();
		while let Ok(Some(line)) = lines.next_line().await {
			if is_stderr {
				tracing::warn!(plugin = %slug, "{line}");
			} else {
				tracing::debug!(plugin = %slug, "{line}");
			}
		}
	});
}

/// Poll `/health` until the plugin answers, it dies, or we run out of patience.
///
/// Watching for early exit matters as much as the timeout: a plugin that fails immediately
/// (missing interpreter, bad argument) should report that in a second rather than making
/// the operator wait out the full startup budget for a process that is already gone.
async fn await_health(
	base_url: &str,
	token: Option<&str>,
	child: &mut Child,
) -> CoreResult<()> {
	// The same client the rest of the system talks to plugins with, so a plugin that
	// passes this probe is reachable by the real code path rather than by a parallel one
	// that might differ in headers, timeouts or URL joining.
	let client = PluginClient::new(base_url, token.map(String::from)).map_err(|e| {
		CoreError::InternalError(format!("Cannot address plugin at {base_url}: {e}"))
	})?;
	let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;

	loop {
		if let Ok(Some(status)) = child.try_wait() {
			return Err(CoreError::InternalError(format!(
				"Plugin exited before becoming healthy ({status})"
			)));
		}

		if let Ok(health) = client.health().await {
			if health.ok {
				return Ok(());
			}
		}

		if tokio::time::Instant::now() >= deadline {
			return Err(CoreError::InternalError(format!(
				"Plugin did not report healthy at {base_url} within {}s",
				STARTUP_TIMEOUT.as_secs()
			)));
		}
		tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn descriptor_json() -> &'static str {
		r#"{"id":"com.example.p","name":"P","command":["./run"]}"#
	}

	#[test]
	fn descriptor_parses_with_only_required_fields() {
		let d: LocalPluginDescriptor = serde_json::from_str(descriptor_json()).unwrap();
		assert_eq!(d.id, "com.example.p");
		assert_eq!(d.command, vec!["./run".to_string()]);
		assert_eq!(d.base_path, None);
	}

	#[test]
	fn a_descriptor_without_a_command_is_rejected() {
		let dir = tempfile::tempdir().unwrap();
		std::fs::write(
			dir.path().join(DESCRIPTOR_FILE),
			r#"{"id":"x","name":"X","command":[]}"#,
		)
		.unwrap();

		let error = LocalPluginDescriptor::read(dir.path()).unwrap_err();
		assert!(
			error.to_string().contains("declares no command"),
			"got: {error}"
		);
	}

	/// A bare name is a PATH lookup and must be left alone, or a plugin could never say
	/// `sh` or `node`.
	#[test]
	fn a_bare_program_name_is_not_path_resolved() {
		let dir = tempfile::tempdir().unwrap();
		assert_eq!(
			resolve_program(dir.path(), "node").unwrap(),
			PathBuf::from("node")
		);
	}

	#[test]
	fn a_program_inside_the_plugin_directory_resolves() {
		let dir = tempfile::tempdir().unwrap();
		let program = dir.path().join("run");
		std::fs::write(&program, "#!/bin/sh\n").unwrap();

		let resolved = resolve_program(dir.path(), "./run").unwrap();
		assert_eq!(resolved, program.canonicalize().unwrap());
	}

	/// The whole path, against the reference plugin: launch a directory, wait for it to
	/// come up, and read the manifest back over the wire Longbox actually uses.
	///
	/// Skipped where `node` is unavailable rather than failed. The supervisor runs whatever
	/// command a descriptor names and has no opinion about language, so this test is about
	/// spawn/health/stop — making it depend on an interpreter being installed everywhere
	/// would buy flakiness for no extra coverage.
	#[tokio::test]
	async fn launches_a_plugin_directory_and_reads_its_manifest() {
		if std::process::Command::new("node")
			.arg("--version")
			.stdout(Stdio::null())
			.stderr(Stdio::null())
			.status()
			.is_err()
		{
			eprintln!("skipping: node is not installed");
			return;
		}

		let reference = Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("../examples/reference-plugin/server.js");
		if !reference.exists() {
			eprintln!("skipping: reference plugin not found");
			return;
		}

		let dir = tempfile::tempdir().unwrap();
		std::fs::copy(&reference, dir.path().join("server.js")).unwrap();
		std::fs::write(
			dir.path().join(DESCRIPTOR_FILE),
			r#"{
				"id": "com.longbox.reference",
				"name": "Reference",
				"command": ["node", "server.js"],
				"base_path": "/longbox/v1"
			}"#,
		)
		.unwrap();

		let descriptor =
			LocalPluginDescriptor::read(dir.path()).expect("descriptor reads");
		let processes = PluginProcesses::new();

		let base_url = processes
			.start("reference", dir.path(), &descriptor, Some("test-token"))
			.await
			.expect("the reference plugin should start and report healthy");

		assert!(base_url.starts_with("http://127.0.0.1:"), "got {base_url}");
		assert!(processes.is_running("reference").await);

		let manifest = PluginClient::new(&base_url, Some("test-token".into()))
			.expect("client builds")
			.manifest()
			.await
			.expect("manifest is served");
		assert_eq!(manifest.protocol, plugin_integrations::PROTOCOL_VERSION);

		processes.stop("reference").await;
		assert!(!processes.is_running("reference").await);
	}

	/// The case this check exists for: a downloaded archive naming something outside its
	/// own directory must not be how it reaches the rest of the filesystem.
	#[test]
	fn a_program_escaping_the_plugin_directory_is_refused() {
		let root = tempfile::tempdir().unwrap();
		let dir = root.path().join("plugin");
		std::fs::create_dir(&dir).unwrap();
		std::fs::write(root.path().join("outside"), "#!/bin/sh\n").unwrap();

		let error = resolve_program(&dir, "../outside").unwrap_err();
		assert!(
			error.to_string().contains("outside its own directory"),
			"got: {error}"
		);
	}
}
