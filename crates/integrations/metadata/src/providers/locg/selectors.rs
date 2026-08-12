//! **Every** CSS selector and markup-shape assumption for League of Comic Geeks
//! lives in this module. Nothing else in the provider may call `Selector::parse`.
//!
//! LOCG has no API, so the provider reads the site's own markup. That markup is not
//! a contract: a redesign will break these selectors, and when it does the fix
//! belongs here and nowhere else. Each selector is annotated with what it targets
//! and how fragile it looks, so whoever repairs it can tell "they renamed a class"
//! from "the data moved".
//!
//! Fragility notes, worst first:
//!
//! 1. **Credits are keyed by story id** — `section#creators-{storyId}` and
//!    `section#characters-{storyId}`, so they must be matched by *prefix*
//!    (`section[id^="creators-"]`), and an anthology yields several of each.
//! 2. **Three different cover-URL conventions.** List cards lazy-load, so the real
//!    URL is in `data-src` and `src` holds a base64 1×1 GIF; the quick-search widget
//!    uses a plain `src`; detail pages expose `og:image`. Reading `src` on a list
//!    card silently yields a placeholder, not a cover.
//! 3. **Issue numbers only exist inside the title** ("Absolute Batman #1") — there is
//!    no numeric field anywhere in the markup.
//! 4. **Page count appears twice** — issue-level in `#comic-details` and per-story in
//!    `#stories`. They differ (44 vs 42 on Absolute Batman #1); we want issue-level.
//! 5. **Variants are ordinary cards** distinguished only by `data-parent != 0`.

use std::sync::LazyLock;

use scraper::Selector;

/// Parse a selector that is known-good at author time. A panic here is a programming
/// error in this module, not a runtime condition, and is caught by this module's tests.
fn sel(s: &'static str) -> Selector {
	Selector::parse(s).unwrap_or_else(|e| panic!("invalid LOCG selector {s:?}: {e}"))
}

// ---------------------------------------------------------------------------
// Series cards — `list=search&list_option=series` → `.list` HTML
// ---------------------------------------------------------------------------

/// One series result. The response wraps cards in a bare `<li>` (no class), so we
/// anchor on the series link the card must contain rather than on the `li` itself.
pub static SERIES_CARD: LazyLock<Selector> = LazyLock::new(|| sel("li"));
/// Series link, carrying both the id (`data-id`) and the canonical URL (`href`).
pub static SERIES_LINK: LazyLock<Selector> =
	LazyLock::new(|| sel("a.link-collection-series[data-id]"));
/// Series display name.
pub static SERIES_TITLE: LazyLock<Selector> = LazyLock::new(|| sel("div.title a"));
/// Lazy-loaded cover — read `data-src`, never `src` (see fragility note 2).
pub static LAZY_COVER: LazyLock<Selector> = LazyLock::new(|| sel("img.lazy[data-src]"));
/// Issue tally shown on the card ("26").
pub static SERIES_ISSUE_COUNT: LazyLock<Selector> =
	LazyLock::new(|| sel("span.details.count-issues"));
/// The card's two-part subtitle: publisher, then a year range ("2024 - Present").
/// Both are bare `<span>`s inside the same wrapper, positional rather than labelled.
pub static SERIES_SUBTITLE_SPANS: LazyLock<Selector> =
	LazyLock::new(|| sel("div.copy-really-small span"));

// ---------------------------------------------------------------------------
// Issue cards — `list=series` / `list=releases` → `.list` HTML
// ---------------------------------------------------------------------------

/// One issue result. Unlike series cards these *are* classed.
pub static ISSUE_CARD: LazyLock<Selector> = LazyLock::new(|| sel("li.issue[data-comic]"));
/// Issue title link → `/comic/{id}/{slug}`.
pub static ISSUE_TITLE_LINK: LazyLock<Selector> = LazyLock::new(|| sel("div.title a"));
/// Publisher name on an issue card.
pub static ISSUE_PUBLISHER: LazyLock<Selector> = LazyLock::new(|| sel("div.publisher"));
/// Store date. Prefer its `data-date` attribute (a Unix timestamp) over the human
/// text ("Oct 9th, 2024"), which is localised and ordinal-suffixed.
pub static ISSUE_DATE: LazyLock<Selector> =
	LazyLock::new(|| sel("div.details span.date"));

// ---------------------------------------------------------------------------
// Quick search — `/search/ajax_issues?query=` → plain HTML, three widgets
// ---------------------------------------------------------------------------

/// The Issues widget. The response also contains Series and Characters widgets, so
/// scoping to this list is what keeps issue results from mixing with them.
pub static WIDGET_COMICS_LIST: LazyLock<Selector> =
	LazyLock::new(|| sel("ul.widget-comics"));
/// One row in a widget list.
pub static WIDGET_ITEM: LazyLock<Selector> = LazyLock::new(|| sel("li.media"));
/// Widget row title link → `/comic/{id}/{slug}`.
pub static WIDGET_TITLE_LINK: LazyLock<Selector> = LazyLock::new(|| sel("div.title a"));
/// Widget row publisher.
pub static WIDGET_PUBLISHER: LazyLock<Selector> = LazyLock::new(|| sel("div.publisher"));
/// Widget row date ("Jun 15th, 2027") — text only, no timestamp attribute here.
pub static WIDGET_DATE: LazyLock<Selector> = LazyLock::new(|| sel("div.date"));
/// Widget row cover — a plain `src`, *not* lazy-loaded (see fragility note 2).
pub static WIDGET_COVER: LazyLock<Selector> = LazyLock::new(|| sel("img[src]"));

// ---------------------------------------------------------------------------
// Series header — the `header` key of a `list=series` response
// ---------------------------------------------------------------------------

/// Publisher + year range, e.g. "DC Comics · 2024 - Present". The only place a
/// series' start/end years appear in a `series_id` fetch.
pub static SERIES_HEADER_INTRO: LazyLock<Selector> =
	LazyLock::new(|| sel("div.header-intro"));

// ---------------------------------------------------------------------------
// Issue detail page — `/comic/{id}/{slug}`
// ---------------------------------------------------------------------------

/// "{Series} #{number}" — the only source of the issue number.
pub static PAGE_TITLE: LazyLock<Selector> =
	LazyLock::new(|| sel("section#comic-header h1"));
/// Publisher + "Released Oct 9, 2024" line above the title.
pub static PAGE_HEADER_INTRO: LazyLock<Selector> =
	LazyLock::new(|| sel("section#comic-header div.header-intro"));
/// Summary, format, page count, price, cover date, UPC and SKU all live here as
/// loosely-structured text rather than labelled fields.
pub static PAGE_DETAILS: LazyLock<Selector> =
	LazyLock::new(|| sel("section#comic-details"));
/// The summary paragraph. It sits in `section#summary`, which is nested *inside*
/// `#comic-details` — hence scoping to the description wrapper rather than to a
/// generic copy class.
pub static PAGE_DETAILS_SUMMARY: LazyLock<Selector> =
	LazyLock::new(|| sel("div.listing-description p"));
/// Canonical cover image.
pub static PAGE_OG_IMAGE: LazyLock<Selector> =
	LazyLock::new(|| sel(r#"meta[property="og:image"]"#));
/// Link back to the parent series — how an issue resolves to its series id.
pub static PAGE_SERIES_LINK: LazyLock<Selector> =
	LazyLock::new(|| sel("a.btn-navigational.series[href]"));
/// Per-story credit blocks; matched by prefix because the id carries a story id.
pub static PAGE_CREATOR_SECTIONS: LazyLock<Selector> =
	LazyLock::new(|| sel(r#"section[id^="creators-"]"#));
/// Cover artists and masthead roles, which sit outside the per-story blocks.
pub static PAGE_TOP_LEVEL_CREDITS: LazyLock<Selector> =
	LazyLock::new(|| sel("section#top-level-credits"));
/// One credit entry: a role label paired with a linked name.
pub static CREDIT_ROLE: LazyLock<Selector> = LazyLock::new(|| sel("div.role"));
/// The name beside a role. Not every credit is a link, so callers fall back to text.
pub static CREDIT_NAME: LazyLock<Selector> = LazyLock::new(|| sel("div.name"));
/// A single credit cell, holding one role + one name pair.
pub static CREDIT_CELL: LazyLock<Selector> = LazyLock::new(|| sel("div.col-auto"));
/// Per-story character blocks; prefix-matched for the same reason as creators.
pub static PAGE_CHARACTER_SECTIONS: LazyLock<Selector> =
	LazyLock::new(|| sel(r#"section[id^="characters-"]"#));
/// A character link inside a characters section.
pub static CHARACTER_LINK: LazyLock<Selector> =
	LazyLock::new(|| sel(r#"a[href^="/character/"]"#));

#[cfg(test)]
mod tests {
	use super::*;

	/// Every selector is built lazily, so a typo would only surface the first time
	/// that particular parse ran — potentially in production, on one code path.
	/// Touching them all here turns that into a compile-time-ish guarantee.
	#[test]
	fn all_selectors_parse() {
		let all: Vec<&LazyLock<Selector>> = vec![
			&SERIES_CARD,
			&SERIES_LINK,
			&SERIES_TITLE,
			&LAZY_COVER,
			&SERIES_ISSUE_COUNT,
			&SERIES_SUBTITLE_SPANS,
			&ISSUE_CARD,
			&ISSUE_TITLE_LINK,
			&ISSUE_PUBLISHER,
			&ISSUE_DATE,
			&WIDGET_COMICS_LIST,
			&WIDGET_ITEM,
			&WIDGET_TITLE_LINK,
			&WIDGET_PUBLISHER,
			&WIDGET_DATE,
			&WIDGET_COVER,
			&SERIES_HEADER_INTRO,
			&PAGE_TITLE,
			&PAGE_HEADER_INTRO,
			&PAGE_DETAILS,
			&PAGE_DETAILS_SUMMARY,
			&PAGE_OG_IMAGE,
			&PAGE_SERIES_LINK,
			&PAGE_CREATOR_SECTIONS,
			&PAGE_TOP_LEVEL_CREDITS,
			&CREDIT_ROLE,
			&CREDIT_NAME,
			&CREDIT_CELL,
			&PAGE_CHARACTER_SECTIONS,
			&CHARACTER_LINK,
		];
		// Forcing each LazyLock is the assertion: `sel` panics on a bad selector.
		for s in all {
			LazyLock::force(s);
		}
	}
}
