---
name: ci-preflight
description: >-
  Run Longbox's full CI gate locally before pushing. Use this whenever you're
  about to push commits, open or update a pull request, or reproduce a red CI
  run — it mirrors .github/workflows/ci.yaml (cargo fmt / clippy -D warnings /
  graphql-schema / cargo test for Rust, and yarn lint / yarn test for the
  frontend) and runs only the gates for the areas you changed, so fmt, clippy,
  schema-drift, and test failures get caught here instead of after CI goes red.
  Also trigger on "preflight", "check CI", "is this safe to push", or after a
  batch of Rust or web edits.
---

# Longbox CI preflight

Longbox's CI (`.github/workflows/ci.yaml`) is strict and split by language:
`cargo clippy -- -D warnings` fails on a single warning, and
`cargo dump-schema -- --check` fails if the committed GraphQL schema has drifted
from the async-graphql code. Because the job is gated by `dorny/paths-filter`,
the Rust and frontend gates run independently based on which paths changed.

This skill reproduces those exact gates locally, in CI order, running only the
ones relevant to your diff.

## How to run it

Run the bundled script from anywhere in the repo:

```bash
.claude/skills/ci-preflight/scripts/preflight.sh
```

It auto-detects changed areas against the `origin/main` merge-base and runs the
matching gates. Force a full run with `--all` (useful right before a release or
when validating a large refactor):

```bash
.claude/skills/ci-preflight/scripts/preflight.sh --all
```

The script continues through every selected gate (it does **not** stop at the
first failure) so you see the complete picture in one pass, then exits non-zero
if any gate failed and prints which ones.

## The gates, and how to fix each failure

Run the script first, then act on whatever it reports. Don't guess at fixes
before seeing which gate failed.

**`cargo fmt --check`** — formatting drift.
Fix: `cargo fmt --all` (rewrites in place), then re-run.

**`cargo clippy -D warnings`** — a lint that CI treats as a hard error.
Read the clippy output and fix the flagged code. These are real and worth
fixing properly rather than silencing; reach for `#[allow(...)]` only when the
lint is genuinely wrong for the case. Re-run to confirm zero warnings.

**`graphql schema in sync`** (`cargo dump-schema -- --check`) — the checked-in
GraphQL SDL no longer matches the async-graphql resolvers, usually because you
added or changed a GraphQL type/field. Fix: regenerate with `cargo dump-schema`
(no `--check`), review the diff, and commit the updated schema. If the frontend
consumes it, also run `cargo codegen` and commit the regenerated TS types.

**`cargo test`** — a failing Rust test. Debug it like any test failure; don't
paper over it to make the gate pass.

**`yarn lint + check-types`** — ESLint (flat config), Prettier, or TypeScript
errors across the JS/TS workspace. Many are auto-fixable: `yarn format` runs
`eslint --fix` + `prettier --write`. Type errors need real fixes — re-run
`yarn check-types` to iterate.

**`yarn test`** — a failing Jest suite (`packages/browser`, `packages/sdk`).
Debug the specific suite.

## When to reach for this

- Before `git push` on a branch that will open or update a PR.
- Right after finishing a batch of Rust edits (clippy/schema are the gates that
  most often surprise) or web edits.
- When CI is already red and you want to reproduce the failure locally before
  attempting a fix.

Skip it for docs-only changes (`docs/**`) — CI's `check-docs` job isn't part of
this preflight, and the Rust/frontend gates won't apply.

## Note on speed

`cargo clippy` and `cargo test` dominate the wall-clock time on a cold target;
incremental runs are much faster. That cost is the point — it's paid locally in
your loop instead of as a red CI run and a re-push. If you only touched one
language, the path filter already skips the other language's gates for you.
