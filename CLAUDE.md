# Longbox

Self-hosted server for comics, manga, and digital books — a hard fork of
[Stump](https://github.com/stumpapp/stump), rebranded as Longbox and published
under `SaintedRogue`. The fork is **fully rebranded to `longbox`**: the server
binary/package is `longbox_server`, the core lib is `longbox_core`, TS packages
are `@longbox/*`, env vars are `LONGBOX_*`, the config file is `Longbox.toml`,
and the data dir is `~/.longbox`; CI is titled "Longbox Checks CI". (The
transitional `STUMP_*` env-var fallback and the `~/.stump→~/.longbox` boot
migration shipped in the first rebrand release and have since been removed —
`STUMP_*` vars and a legacy `~/.stump` dir are no longer read.) Upstream attribution — `stumpapp/stump`
links, the MIT `LICENSE`, "fork of Stump" credit, and the sample data in
`crates/email` — is deliberately preserved; don't "fix" those to Longbox.

## Layout — a two-language monorepo

Rust (Cargo workspace) and TypeScript (yarn 1 + lerna) live side by side. This
split is the single most important thing to internalize: CI, tests, and tooling
are separate per language, and a change to one rarely touches the other.

**Rust** (`cargo`, edition workspace, rust-version 1.92):

- `apps/server` — axum HTTP server (package/bin `longbox_server`)
- `core` — core library / lib `longbox_core` (business logic, models, jobs)
- `crates/*` — `cli`, `email`, `graphql`, `migrations`, `models`, `tests`
- `crates/integrations/*` — `metadata`, `notification` (external APIs)
- `crates/macros/*` — proc-macros
- Stack: axum 0.8, async-graphql 7.2, apalis (job queue), **SeaORM 1.1 +
  SQLite**, bcrypt auth.

**TypeScript** (`yarn` classic 1.22, lerna, Node ≥20):

- `apps/web` — React 19 PWA (`@longbox/web`), Vite 7, Tailwind 4, React Router 6,
  vite-plugin-pwa
- `packages/*` — `sdk`, `client`, `browser`, `components`, `graphql`, `i18n`
- `docs` — documentation app
- Data layer: axios + zustand; GraphQL via gql.tada / `@0no-co/graphqlsp`.

## Common commands

```bash
# First-time setup: install deps, build web, generate GraphQL code
yarn setup

# Dev: runs the Rust server (bacon, headless) + web dev server together
yarn dev:web

# Rust
cargo build-server          # release build of longbox_server (alias)
cargo test
cargo fmt --all             # format
cargo clippy -- -D warnings # lint (CI treats warnings as errors)
cargo dump-schema           # regenerate GraphQL SDL from resolvers
cargo dump-schema -- --check# verify SDL matches code (CI gate)
cargo migrate               # run DB migrations  (cargo rollback = down 1)

# Regenerate the TS GraphQL client from the schema (the `cargo codegen` alias
# is stale — there is no `codegen` package):
yarn workspace @longbox/graphql codegen

# TypeScript (run from repo root)
yarn lint                   # eslint + prettier + check-types
yarn format                 # eslint --fix + prettier --write
yarn test                   # jest across packages
```

Cargo aliases (`cargo build-server`, `dump-schema`, `migrate`, `rollback`,
`integration-tests`) are defined in `.cargo/config.toml`. (A `codegen` alias is
also declared there but is stale — it points at a `codegen` package that doesn't
exist; use `yarn workspace @longbox/graphql codegen` instead.)

## Before you push — reproduce CI locally

CI (`.github/workflows/ci.yaml`) is strict and **change-gated** (dorny/paths-filter
runs the Rust and frontend jobs independently based on which paths changed). The
gates are:

| Gate                  | Command                        |
| --------------------- | ------------------------------ |
| Rust format           | `cargo fmt --all -- --check`   |
| Rust lint             | `cargo clippy -- -D warnings`  |
| GraphQL schema drift  | `cargo dump-schema -- --check` |
| Rust tests            | `cargo test`                   |
| Frontend lint + types | `yarn lint`                    |
| Frontend tests        | `yarn test`                    |

Use the **`ci-preflight` skill** to run exactly these locally, scoped to your
diff, before pushing: `.claude/skills/ci-preflight/scripts/preflight.sh`.
`clippy -D warnings` and schema-drift are the two that most often surprise —
adding a GraphQL field means you must `cargo dump-schema` (and usually
regenerate the TS client via `yarn workspace @longbox/graphql codegen`) and
commit the regenerated output.

## Conventions & gotchas

- **Centralized deps**: every crate pulls its dependencies from the root
  `[workspace.dependencies]` in `Cargo.toml` (kept alphabetical) unless there's
  a specific reason not to. Add/bump versions there, not in individual crates.
- **react-compiler is on** (`babel-plugin-react-compiler` in
  `apps/web/vite.config.ts`, enforced by eslint-plugin-react-compiler). Follow
  the Rules of React — no mutating props/state, no conditional hooks. Past bugs
  came from patterns the compiler rejects (e.g. `useRef` used where `useState`
  was needed).
- **Pre-commit**: husky + lint-staged run `prettier --check` on JS/TS and
  `cargo fmt --check` on Rust. The preflight skill is the fuller gate.
- **Secrets**: `longbox.env` holds real secrets and is gitignored — never commit
  it or echo its contents.

## Deploy

Docker image published to **`ghcr.io/saintedrogue/longbox`** (single SQLite
container), consumed by an **Unraid** template in `deploy/unraid/`. Rust CI runs
on a **self-hosted runner** (see the `devbox build host` memory for the image
build machine).

- **Reverse-proxy gotcha**: behind NPM/Traefik, set
  `LONGBOX_TRUST_PROXY_HEADERS=true` — otherwise server-built cover/thumbnail
  URLs point at the internal `:10801` and 404 (covers render blank). See the
  `reverse-proxy-trust-headers` memory.
