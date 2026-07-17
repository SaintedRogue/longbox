# Longbox → Unraid Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Longbox as a public, provenance-attested image on GHCR built by CI, and ship an Unraid `dockerMan` template so the server deploys the same way `roguemeso` does.

**Architecture:** Longbox is a single Rust binary with an embedded SQLite database, so this is a _one-container_ deployment (no DB container, no seed). A GitHub Actions workflow runs on a **self-hosted runner on the Unraid host** (which drives the host Docker daemon, so the Dockerfile's BuildKit cache-mounts persist → ~2–6 min builds). On push to `main` it does a plain `docker build`/`docker push` to `ghcr.io/saintedrogue/longbox` (`:latest` + `:<sha>`) and attaches a Sigstore provenance attestation. Users deploy via an Unraid template that mounts `/config` (appdata) and `/data` (library) and exposes port 10801. It replaces the upstream `aaronleopold/stump` container the box runs today (same `/config` + `/data` carry over).

**Tech Stack:** Docker + BuildKit, GitHub Actions (`docker/login-action`, `actions/attest-build-provenance`), GHCR, Unraid `dockerMan` XML templates, self-hosted GitHub Actions runner (container on Unraid host).

## Global Constraints

- Image name (lowercase for CI): `ghcr.io/saintedrogue/longbox`; tags `latest` + short-SHA. Unraid XML `<Repository>` may use canonical case `ghcr.io/SaintedRogue/longbox`.
- **amd64 only.**
- Build **must** pass `--build-arg GIT_REV=<short-sha>`: `.git` is `.dockerignore`d and `apps/server/build.rs` + `core/build.rs` panic if they can't resolve the rev.
- Container defaults: port `10801`; `STUMP_CONFIG_DIR=/config`; library root `/data`; `PUID=99` / `PGID=100` (Unraid `nobody:users`); `TZ`.
- GHCR auth in CI uses the built-in `GITHUB_TOKEN` (`packages: write`) — **no** Docker Hub secrets. Provenance uses OIDC (`id-token: write`, `attestations: write`).
- Do **not** rename internal crates/consts/files (`stump_core`, `STUMP_SHADOW_TEXT`, `stump_shadow_text.txt`) — not user-facing; renaming is a breaking refactor, out of scope.
- Verification build host: devbox — SSH `10.0.0.50` root/root (see `~/devbox.env`), drives the Unraid host Docker daemon.

---

### Task 1: Create the deployment branch and commit the verified branding cleanup

The branding edits are already made and verified on devbox (banner prints `Longbox`, 0 Stump lines). This task isolates the deployment work on its own branch and lands those edits.

**Files:**

- Modify (already edited, uncommitted): `core/src/config/stump_shadow_text.txt` (banner → Longbox)
- Modify (already edited, uncommitted): `docker/Dockerfile:102-108` (OCI labels → Longbox/SaintedRogue)

**Interfaces:**

- Produces: branch `deploy/unraid-ghcr` containing all subsequent tasks' commits.

- [ ] **Step 1: Create the branch off `main`** (carries the uncommitted branding edits with it)

```bash
cd /home/rogue/longbox
git stash            # park the branding edits if the tree is dirty on another branch
git checkout main
git checkout -b deploy/unraid-ghcr
git stash pop        # restore the branding edits onto the new branch
```

(If the tree is already clean because the edits are committed elsewhere, skip the stash and cherry-pick instead.)

- [ ] **Step 2: Confirm exactly the two branding files are changed**

Run: `git status --short`
Expected: `M core/src/config/stump_shadow_text.txt` and `M docker/Dockerfile` — nothing else.

- [ ] **Step 3: Confirm the banner content is the Longbox banner**

Run: `head -1 core/src/config/stump_shadow_text.txt`
Expected: `Longbox configuration and pre-startup complete!`

- [ ] **Step 4: Commit**

```bash
git add core/src/config/stump_shadow_text.txt docker/Dockerfile
git commit -m "chore(branding): rebrand startup banner + image labels Stump → Longbox"
```

---

### Task 2 (OPTIONAL — decision required): Extend branding to OPDS + User-Agent

**Skip unless the user explicitly opts in.** These are _wire-visible_ values, not cosmetic: the outbound `User-Agent` may be keyed on by external services (relevant to the Metron work), and OPDS author URIs appear in clients. Do this only as a deliberate choice.

**Files:**

- Modify: `apps/server/src/routers/api/v2/mod.rs:93` — `USER_AGENT, "stumpapp/stump"` → `"longbox/longbox"` (or `"SaintedRogue/longbox"`)
- Modify: `core/src/opds/v1_2/author.rs:20,90,102`, `core/src/opds/v1_2/feed.rs:293`, `core/src/opds/v2_0/link.rs:227` — `stumpapp.dev` / `github.com/stumpapp/stump` → Longbox URLs
- Modify matching test assertions (e.g. `core/src/opds/v2_0/link.rs:439`)
- **Do NOT touch** code comments citing upstream issue numbers (provenance).

- [ ] **Step 1: Change the values, then update the failing test assertions to match**

- [ ] **Step 2: Run the OPDS + server tests**

Run: `cargo test -p stump_core opds:: && cargo test -p longbox_server`
Expected: PASS (after updating assertions).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(branding): point OPDS metadata + outbound User-Agent at Longbox"
```

---

### Task 3: Add the GHCR publish workflow

**Files:**

- Create: `.github/workflows/publish-image.yml`

**Interfaces:**

- Consumes: a self-hosted runner labelled `self-hosted,longbox` with access to the host Docker socket (registered in Task 5).
- Produces: images `ghcr.io/saintedrogue/longbox:latest` and `:<sha>` + a provenance attestation, on every push to `main`.

- [ ] **Step 1: Write the workflow**

```yaml
name: Publish image to GHCR

on:
  push:
    branches: [main]
    paths-ignore:
      - 'docs/**'
      - '**.md'
  workflow_dispatch:

concurrency:
  group: publish-image-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-push:
    name: Build & push (amd64) to GHCR with provenance
    runs-on: [self-hosted, longbox]
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # build.rs needs real git history for the rev

      - name: Compute short SHA
        id: vars
        run: echo "sha=$(git rev-parse --short=8 HEAD)" >> "$GITHUB_OUTPUT"

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # Plain docker build on the HOST daemon so the Dockerfile's
      # --mount=type=cache (cargo registry + target) persists between runs.
      # Do NOT swap this for a docker-container buildx builder + type=gha
      # cache — that discards the host cache and makes builds ~5x slower.
      - name: Build image
        run: |
          docker build -f docker/Dockerfile \
            --build-arg GIT_REV=${{ steps.vars.outputs.sha }} \
            --build-arg BUILD_CHANNEL=stable \
            -t ghcr.io/saintedrogue/longbox:latest \
            -t ghcr.io/saintedrogue/longbox:${{ steps.vars.outputs.sha }} \
            .

      - name: Push image
        id: push
        run: |
          docker push ghcr.io/saintedrogue/longbox:latest
          docker push ghcr.io/saintedrogue/longbox:${{ steps.vars.outputs.sha }}
          digest=$(docker inspect --format='{{index .RepoDigests 0}}' \
            ghcr.io/saintedrogue/longbox:${{ steps.vars.outputs.sha }} | cut -d@ -f2)
          echo "digest=$digest" >> "$GITHUB_OUTPUT"

      - name: Attest build provenance
        uses: actions/attest-build-provenance@v2
        with:
          subject-name: ghcr.io/saintedrogue/longbox
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

- [ ] **Step 2: Lint the workflow YAML**

Run (if `actionlint` available): `actionlint .github/workflows/publish-image.yml`
Expected: no errors. (If `actionlint` is absent, verify with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish-image.yml'))"` → no output = valid YAML.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-image.yml
git commit -m "ci: publish provenance-attested Longbox image to GHCR on push to main"
```

---

### Task 4: Retire the inherited Stump Docker publishers

These push to `docker.io/aaronleopold` via a buildah self-hosted action the fork doesn't have. Remove them so the only publisher is Task 3.

**Files:**

- Delete: `.github/workflows/release_docker.yml`
- Delete: `.github/workflows/nightly.yml`
- Delete: `.github/workflows/unstable.yml`
- Delete: `.github/actions/build-docker/action.yml` (and the now-empty dir)
- Keep: `docker/Dockerfile`, `docker/entrypoint.sh`, `docker/build_server.sh` (reused by Task 3)
- Keep: `release_binary.yml`, `build_nix.yml`, `cve_check.yml`, `ci.yaml`, `label_issue.yml`

- [ ] **Step 1: Remove the files**

```bash
git rm .github/workflows/release_docker.yml \
       .github/workflows/nightly.yml \
       .github/workflows/unstable.yml \
       .github/actions/build-docker/action.yml
rmdir .github/actions/build-docker 2>/dev/null || true
```

- [ ] **Step 2: Verify no remaining references to the old registry or action**

Run: `grep -rn "aaronleopold\|build-docker\|DOCKERHUB" .github/ docker/`
Expected: no matches (or only unrelated historical references you confirm are fine).

- [ ] **Step 3: Decide the `ci.yaml` self-hosted question** (note, not code)

`ci.yaml`'s `check-rust`/`check-coverage` use `runs-on: [self-hosted]`. Once Task 5 registers a runner with the `self-hosted` label, those jobs will start running on it. That's fine (your Rust CI finally runs) — but if you'd rather not, either (a) repoint them to `ubuntu-latest`, or (b) give the builder a _unique-only_ label. Default: leave as-is and let them run. Record the choice here.

- [ ] **Step 4: Commit**

```bash
git commit -m "ci: retire inherited Stump Docker Hub publish workflows (replaced by GHCR publish)"
```

---

### Task 5: Register the self-hosted runner on the Unraid host

One-time infrastructure. The runner is a container on the Unraid host with the host Docker socket mounted (same shape as devbox), so builds use the host's persistent BuildKit cache. Ephemeral + your-branches-only for safety (public repo).

**Files:** none in-repo (infra). Document the exact steps in `deploy/unraid/README.md` (Task 6) under "CI runner (optional)".

- [ ] **Step 1: Create a fine-grained PAT**

GitHub → Settings → Developer settings → Fine-grained tokens: scope to `SaintedRogue/longbox`, permission **Administration: Read and write** (lets the container fetch/renew its registration token). Save as `RUNNER_PAT`.

- [ ] **Step 2: Harden fork-PR execution** (public repo)

Repo → Settings → Actions → General → "Fork pull request workflows from outside collaborators" → **Require approval for all outside collaborators**.

- [ ] **Step 3: Run the runner container on the Unraid host** (Community Applications → `myoung34/github-runner`, or CLI)

```bash
docker run -d --restart unless-stopped --name longbox-runner \
  -e REPO_URL=https://github.com/SaintedRogue/longbox \
  -e ACCESS_TOKEN=<RUNNER_PAT> \
  -e RUNNER_NAME=unraid-longbox \
  -e LABELS=self-hosted,longbox \
  -e EPHEMERAL=true \
  -e RUN_AS_ROOT=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  myoung34/github-runner:latest
```

Notes: mount **only** the docker socket — do **not** mount `/mnt/user` or appdata into this container. `EPHEMERAL=true` gives a clean runner per job; the build cache still persists because builds run on the _host_ daemon.

- [ ] **Step 4: Verify the runner is online**

GitHub → repo → Settings → Actions → Runners.
Expected: `unraid-longbox` shows **Idle**, labels `self-hosted, longbox`.

- [ ] **Step 5: Smoke-test the pipeline via `workflow_dispatch`**

Actions → "Publish image to GHCR" → Run workflow (branch `main`, or temporarily on `deploy/unraid-ghcr` by adding it to the trigger for the test).
Expected: green run; job builds in ~2–6 min; `ghcr.io/saintedrogue/longbox:<sha>` appears under the repo's Packages.

---

### Task 6: Unraid dockerMan template + README

**Files:**

- Create: `deploy/unraid/longbox.xml`
- Create: `deploy/unraid/README.md`

- [ ] **Step 1: Write the template**

`deploy/unraid/longbox.xml`:

```xml
<?xml version="1.0"?>
<Container version="2">
  <Name>longbox</Name>
  <Repository>ghcr.io/SaintedRogue/longbox:latest</Repository>
  <Registry>https://ghcr.io/SaintedRogue/longbox</Registry>
  <Network>br0</Network>
  <MyIP>10.0.0.233</MyIP>
  <Privileged>false</Privileged>
  <Support/>
  <Project>https://github.com/SaintedRogue/longbox</Project>
  <Overview>Longbox — a fast, self-hosted, PWA-first server for comics, manga, and digital books, with full OPDS support. A single Rust binary with an embedded SQLite database (no separate DB container). On first start it creates its config + database under /config and serves the web app / OPDS on port 10801. Add libraries pointing at folders under /data (your mounted comics/books). Public image on GHCR — pulls with no docker login; each build carries signed provenance.</Overview>
  <Category>MediaApp:Books</Category>
  <WebUI>http://[IP]:[PORT:10801]</WebUI>
  <Icon>https://cdn.jsdelivr.net/gh/SaintedRogue/longbox@main/.github/images/logo.png</Icon>
  <ExtraParams/>
  <PostArgs/>
  <DonateText/>
  <DonateLink/>
  <Description>Longbox comics/manga/ebook server (PWA-first fork of Stump). Point a library at a folder under /data and browse at IP:10801. Requires no database container.</Description>
  <Config Name="WebUI port" Target="10801" Default="10801" Mode="tcp" Description="App HTTP port (web UI + OPDS). On br0 reach it at this IP:10801." Type="Port" Display="always" Required="false" Mask="false">10801</Config>
  <Config Name="Config / database" Target="/config" Default="/mnt/cache/appdata/longbox" Mode="rw" Description="Longbox config + SQLite database + thumbnails. Keep on the NVMe cache (appdata)." Type="Path" Display="always" Required="true" Mask="false">/mnt/cache/appdata/longbox</Config>
  <Config Name="Library (comics/books)" Target="/data" Default="/mnt/user/media/comics" Mode="rw" Description="Your comics/manga/book library root. Inside Longbox, add libraries pointing at folders under /data. Use rw only if you enable writing ComicInfo.xml back into archives; otherwise ro is safer." Type="Path" Display="always" Required="true" Mask="false">/mnt/user/media/comics</Config>
  <Config Name="PUID" Target="PUID" Default="99" Mode="" Description="User ID owning /config and /data (Unraid default 99 = nobody)." Type="Variable" Display="always" Required="true" Mask="false">99</Config>
  <Config Name="PGID" Target="PGID" Default="100" Mode="" Description="Group ID owning /config and /data (Unraid default 100 = users)." Type="Variable" Display="always" Required="true" Mask="false">100</Config>
  <Config Name="TZ" Target="TZ" Default="Etc/UTC" Mode="" Description="Container timezone, e.g. America/New_York." Type="Variable" Display="always" Required="false" Mask="false">Etc/UTC</Config>
</Container>
```

- [ ] **Step 2: Validate the XML**

Run: `xmllint --noout deploy/unraid/longbox.xml && echo OK`
Expected: `OK`. (If `xmllint` is absent: `python3 -c "import xml.dom.minidom as m; m.parse('deploy/unraid/longbox.xml'); print('OK')"`.)

- [ ] **Step 3: Cross-check the template against the image contract**

Confirm each of these matches `docker/Dockerfile` / `entrypoint.sh`: port `10801` (Dockerfile `ARG PORT=10801`), `/config` (`STUMP_CONFIG_DIR=/config`), `/data` (docs library root), `PUID`/`PGID` (entrypoint). Expected: all consistent.

- [ ] **Step 4: Write the README**

`deploy/unraid/README.md`:

````markdown
# Longbox on Unraid

One container — Longbox is a single Rust binary with an embedded SQLite database,
so there's **no database container** to run. The app image is **public** on GHCR
and pulls with no `docker login`. Each image carries signed build provenance;
verify it came from this repo's CI with:

```sh
gh attestation verify oci://ghcr.io/saintedrogue/longbox:latest -R SaintedRogue/longbox
```

| Container | Image                                 | Suggested IP | Purpose                           |
| --------- | ------------------------------------- | ------------ | --------------------------------- |
| `longbox` | `ghcr.io/saintedrogue/longbox:latest` | `10.0.0.233` | The app (web UI + OPDS on :10801) |

## Import the template

```sh
scp deploy/unraid/longbox.xml \
    root@10.0.0.2:/boot/config/plugins/dockerMan/templates-user/
```

Then **Docker → Add Container → Template → longbox**.

## Configure & start

- **IP:** pick a free static IP on `br0` (suggested `10.0.0.233`; verify it's unused).
  Prefer bridge networking? Set Network to `bridge` — port `10801` is then published on the host.
- **Config / database → `/config`:** defaults to `/mnt/cache/appdata/longbox` (NVMe). Holds the
  SQLite DB, config, and thumbnails.
- **Library → `/data`:** point at your comics/books share (e.g. `/mnt/user/media/comics`). Inside
  Longbox you add libraries by the path **as seen in the container**, i.e. under `/data`.
- **PUID/PGID:** `99`/`100` (Unraid `nobody:users`) unless your media is owned by another user.
- Start it, then open `http://10.0.0.233:10801` and create your first user / add a library.

## Migrating from the upstream `aaronleopold/stump` container

Longbox reads the same `/config` (SQLite + thumbnails) and `/data` layout as Stump. To switch in place:

1. Stop the `stump` container (don't delete its appdata).
2. In the `longbox` template, set `/config` to Stump's existing appdata path and `/data` to the same library path.
3. Start `longbox`. Your libraries, reading progress, and thumbnails carry over.
   (Take a backup of the appdata dir first — Longbox is beta.)

## Updating

Push to `main` publishes a new `:latest` (see the repo's Publish workflow). In Unraid, use
_Force update_ / _check for updates_ on the `longbox` container.

## CI runner (optional — for maintainers)

To have pushes to `main` auto-build the image on this box, run a GitHub Actions runner container
with the host Docker socket mounted (builds use the host's persistent BuildKit cache → ~2–6 min):

```sh
docker run -d --restart unless-stopped --name longbox-runner \
  -e REPO_URL=https://github.com/SaintedRogue/longbox \
  -e ACCESS_TOKEN=<fine-grained PAT: Administration r/w> \
  -e RUNNER_NAME=unraid-longbox -e LABELS=self-hosted,longbox \
  -e EPHEMERAL=true -e RUN_AS_ROOT=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  myoung34/github-runner:latest
```

Mount **only** the docker socket — never your media/appdata — and keep fork-PR approval on
(Settings → Actions → General), since the runner shares the host Docker daemon.
````

- [ ] **Step 5: Commit**

```bash
git add deploy/unraid/longbox.xml deploy/unraid/README.md
git commit -m "docs(deploy): add Unraid dockerMan template + README for Longbox"
```

---

### Task 7: Point the install docs at the GHCR image

The published docs still show `aaronleopold/stump:latest`.

**Files:**

- Modify: `docs/content/docs/getting-started/installation/docker.mdx`

- [ ] **Step 1: Replace the image + container name references**

Change every `aaronleopold/stump:latest` → `ghcr.io/saintedrogue/longbox:latest`, `container_name: stump` → `container_name: longbox`, and the `docker logs -f stump` / `docker pull ...` / `docker compose pull stump` lines to `longbox`. Leave the `/config` + `/data` volumes and port `10801` as-is (already correct). Add one line noting the image is public on GHCR and needs no `docker login`.

- [ ] **Step 2: Verify no stale upstream image references remain in the doc**

Run: `grep -n "aaronleopold/stump" docs/content/docs/getting-started/installation/docker.mdx`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/content/docs/getting-started/installation/docker.mdx
git commit -m "docs: point Docker install guide at the GHCR Longbox image"
```

---

### Task 8: Go live — publish, make public, and verify end-to-end

**Files:** none (operational). This is the acceptance test for the whole plan.

- [ ] **Step 1: Merge `deploy/unraid-ghcr` → `main`** (via PR). The push to `main` triggers `publish-image.yml`.

- [ ] **Step 2: Make the GHCR package public** (one-time)

GitHub → your profile/org → Packages → `longbox` → Package settings → Change visibility → **Public**. (First publish creates it private.)

- [ ] **Step 3: Verify anonymous pull works** (no login)

Run on any machine: `docker logout ghcr.io; docker pull ghcr.io/saintedrogue/longbox:latest`
Expected: pulls successfully with no credentials.

- [ ] **Step 4: Verify provenance**

Run: `gh attestation verify oci://ghcr.io/saintedrogue/longbox:latest -R SaintedRogue/longbox`
Expected: `✓ Verification succeeded` referencing the `publish-image.yml` workflow.

- [ ] **Step 5: Verify the image boots and is Longbox**

```bash
docker run -d --name longbox_acc ghcr.io/saintedrogue/longbox:latest
sleep 8
docker logs longbox_acc 2>&1 | grep -c "Longbox configuration"   # expect 1
docker logs longbox_acc 2>&1 | grep -c "Stump configuration"     # expect 0
docker rm -f longbox_acc
```

Expected: `1` then `0`, and the LONGBOX banner in the logs.

- [ ] **Step 6: Deploy on Unraid & cut over** (per `deploy/unraid/README.md`) — import the template, point `/config` + `/data` at the existing Stump appdata/library, stop `stump`, start `longbox`, confirm libraries + reading progress carry over at `http://<ip>:10801`. Keep a backup of appdata first.

---

## Notes / open decisions carried from planning

- **Automated CI vs. manual push:** this plan chooses the self-hosted runner (Task 5) for the roguemeso "push → image appears" experience. Fallback if you'd rather not run a runner: skip Tasks 3 & 5 and publish manually from devbox with `docker build … && docker push …` + a local `attest` step. Pick one before executing Task 3.
- **Branding fringe (Task 2):** left optional/off by default because User-Agent + OPDS URIs are wire-visible.
- **Measured build times (on the Unraid host):** cold ~6 min, warm ~2 min, 143 MB image — no cargo-chef needed.
