# Longbox on Unraid

One container. Longbox is a single Rust binary with an embedded SQLite database, so
there is **no database container** to run. The app image is **public** on GHCR and
pulls with no `docker login`. Each image carries signed build provenance; verify it
came from this repo's CI with:

```sh
gh attestation verify oci://ghcr.io/saintedrogue/longbox:latest -R SaintedRogue/longbox
```

| Container | Image                                 | Suggested IP | Purpose                               |
| --------- | ------------------------------------- | ------------ | ------------------------------------- |
| `longbox` | `ghcr.io/saintedrogue/longbox:latest` | `10.0.0.233` | The app (web UI + OPDS on port 10801) |

## Import the template

Copy the XML to the Unraid templates dir, then add the container from the
**Docker → Add Container → Template** dropdown:

```sh
# from this repo, copy to the server (adjust host)
scp deploy/unraid/longbox.xml \
    root@10.0.0.2:/boot/config/plugins/dockerMan/templates-user/
```

## Configure & start

1. **IP / network.** Pick a free static IP on `br0` (suggested `10.0.0.233`; verify it's
   unused on your LAN). Prefer bridge networking? Set **Network** to `bridge` — port
   `10801` is then published on the host instead.
2. **Config / database → `/config`.** Defaults to `/mnt/cache/appdata/longbox` (NVMe cache).
   Holds the SQLite database, config, and thumbnails.
3. **Library → `/data`.** Point at your comics/books share (e.g. `/mnt/user/media/comics`).
   Inside Longbox you add libraries by the path **as seen in the container** — i.e. folders
   under `/data`.
4. **PUID / PGID.** `99` / `100` (Unraid `nobody:users`) unless your media is owned by
   another user.
5. Start it, then open `http://10.0.0.233:10801`, create your first user, and add a library.

## Behind a reverse proxy (NGINX Proxy Manager, Traefik, …)

Longbox builds absolute URLs for covers, thumbnails, and OPDS feeds from the incoming
request. To do that correctly behind a proxy it must trust the proxy's forwarded headers,
so the template ships **`LONGBOX_TRUST_PROXY_HEADERS=true`** on by default.

- **Keep it `true`** whenever a proxy terminates TLS in front of Longbox. Otherwise Longbox
  assumes it's reached directly and stamps its internal `:10801` port (and `http`) onto
  cover/thumbnail URLs. Your browser then can't reach `https://your-domain:10801/…` through
  the proxy, so **every cover/thumbnail shows blank** even though the pages themselves load.
- **The proxy must forward the standard headers.** NGINX Proxy Manager and Traefik send
  `X-Forwarded-Proto` / `X-Forwarded-For` by default — no extra config needed. In NPM just
  point the Proxy Host at `http://<longbox-ip>:10801` (enable **Websockets Support** for the
  live GraphQL subscription).
- **Set it `false`** only if you expose Longbox directly by `IP:port` with no proxy, since a
  directly-exposed server should not trust client-supplied `X-Forwarded-*` headers.

Already running the container? Edit it in Unraid → add a **Variable**: Key
`LONGBOX_TRUST_PROXY_HEADERS`, Value `true`, then **Apply** (Unraid recreates the container).

## Migrating from the upstream `aaronleopold/stump` container

Longbox reads the same `/config` (SQLite + thumbnails) and `/data` layout as Stump, so you
can switch in place:

1. **Back up** your Stump appdata directory first — Longbox is beta.
2. Stop the `stump` container (don't delete its appdata).
3. In the `longbox` template, set `/config` to Stump's existing appdata path and `/data` to
   the same library path.
4. Start `longbox`. Your libraries, reading progress, and thumbnails carry over.

## Updating

A push to `main` publishes a new `:latest` (see `.github/workflows/publish-image.yml`). In
Unraid, use _Force update_ / _check for updates_ on the `longbox` container.

## Upgrading to a rebranded (`LONGBOX_*`) release

Longbox's internal identifiers used to be `stump`-branded; this release finishes renaming
them. Upgrading is automatic, but note the following:

- **Back up your appdata (`/config`) before upgrading.** Standard precaution for any update.
- **Data files auto-migrate on first boot.** The server renames its legacy data dir
  `~/.stump` → `~/.longbox`, along with `Stump.toml` → `Longbox.toml`, `stump.db` →
  `longbox.db`, and `Stump.log` → `Longbox.log`. In this Docker/Unraid setup, `/config` itself
  doesn't move — only the `stump.db` (+ `-wal`/`-shm`) → `longbox.db` file rename applies.
- **You'll be logged out once.** The session cookie name changed as part of the rebrand, so
  your browser's existing session won't validate — just log back in.
- **Re-create any API keys.** The API key prefix changed (`stump_...` → `longbox_...`), so
  keys generated before this release will stop validating. Generate new ones from Settings.
- **Environment variables are now `LONGBOX_*`.** The template above already uses
  `LONGBOX_TRUST_PROXY_HEADERS`. Legacy `STUMP_*` variables are still honored this release
  (the server logs a deprecation warning for each one it falls back to) — update any custom
  variables you've set to the `LONGBOX_*` form at your convenience.

## CI runner (optional — for maintainers)

To have pushes to `main` auto-build the image on this box, run a GitHub Actions runner
container with the host Docker socket mounted (builds then use the host's persistent
BuildKit cache → ~2–6 min):

```sh
docker run -d --restart unless-stopped --name longbox-runner \
  -e REPO_URL=https://github.com/SaintedRogue/longbox \
  -e RUNNER_NAME=unraid-longbox \
  -e RUNNER_TOKEN=<repo registration token> \
  -e RUNNER_SCOPE=repo \
  -e LABELS=longbox \
  -e RUNNER_WORKDIR=/tmp/runner \
  -e DISABLE_AUTOMATIC_DEREGISTRATION=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /mnt/cache/appdata/github_runner/persistent_files:/runner/persistent_files \
  -v /tmp/runner:/tmp/runner \
  myoung34/github-runner:latest
```

Mount **only** the docker socket (never your media/appdata) and keep fork-PR approval on
(Settings → Actions → General), since the runner shares the host Docker daemon.
`DISABLE_AUTOMATIC_DEREGISTRATION=true` is required when reusing a persisted runner.
