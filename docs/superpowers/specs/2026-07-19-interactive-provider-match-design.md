# Interactive provider metadata search & match

## Goal

Audiobookshelf-style manual matching: pick an enabled provider, query for a
series or issue, see the returned results **with confidence side-by-side**, and
select the one to apply. Reachable from an issue and from a series action menu.

This extends the on-demand search shipped in PR #8 (parser-prefilled fields +
per-field overrides) with (a) provider selection and (b) a compare-grid results
view instead of the one-at-a-time review dialog.

## Backend (additive, small)

Two optional args on the existing fetch mutations — behavior unchanged when
omitted:

- `provider: MetadataProvider` — scope the search to ONE provider instead of all
  enabled. Core filters `provider_configs` to that provider (error if it isn't
  enabled for the library type).
- `autoApply: Boolean` (default `true`) — the interactive dialog passes `false`
  so the fetch record stays `AWAITING_REVIEW` and the user can `acceptMediaMatch`
  / `acceptSeriesMatch` **any** candidate. Without this, a ≥threshold top match
  auto-applies (status → `Fetched`) and blocks re-selection.

`core::fetch_media_metadata` / `fetch_series_metadata` gain matching
`provider_filter: Option<MetadataProvider>` and `auto_apply: bool` params.

No metadata-type changes: `ExternalMediaMetadata.coverUrl` /
`ExternalSeriesMetadata.coverUrl` are already exposed (ComicVine populates them),
so result cards can show covers.

## Frontend

- **`ProviderMatchDialog`** — a controlled Dialog. Header controls: a **provider
  dropdown** (enabled providers from `metadataProviderConfigs`, plus an "All
  enabled" default) + editable query fields (series/title, issue #, year,
  publisher) pre-filled from `parseComicFilename`. **Search** fires
  `fetchMediaMetadata`/`fetchSeriesMetadata` with `{ provider, autoApply:false,
query }`.
- **Results grid** — each candidate as a card: cover thumbnail (`coverUrl`,
  placeholder fallback), title, subtitle (year · publisher · first credit),
  provider name, `ConfidenceBadge`, and a **Select** action. Select →
  `acceptMediaMatch`/`acceptSeriesMatch(candidateIndex)` → toast + invalidate +
  close.
- **Entry points**: the issue page ("Find metadata match" button, evolved from
  PR #8's popover into this dialog) and the **series action menu**
  (`SeriesHeader` dropdown → "Match metadata…").

Reuses: `ConfidenceBadge`, the accept mutations, `parseComicFilename`, and the
book search-context query from PR #8. The one-at-a-time `MatchReviewDialog`
stays as-is for the auto-fetch review flow.

## Out of scope (v1)

- Cover images for providers other than ComicVine (Metron/Hardcover leave
  `coverUrl` null → placeholder).
- Persisting the last-used provider per user.
