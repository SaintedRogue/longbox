# Metron credential validation — design

Date: 2026-07-16
Branch: wave3b-stream4
Status: approved, implementing

## Problem

Metron metadata requests were failing in a way that looked like bad credentials but
often was not. Two root causes, confirmed against Metron's published API guidelines
(`metron.cloud/wiki/api/api-guidelines/`, last modified 2026-03-04):

1. **No User-Agent.** The metadata HTTP client was built from a bare
   `reqwest::Client::new()`, which sends no User-Agent. Metron's guidelines make a
   UA mandatory and state that a missing UA — or a _browser_ UA — will "very likely"
   be banned by their bot/AI filters. (Fixed separately; see "Prerequisite".)
2. **No real validation for Metron.** Credential validation is done client-side in
   the browser (`ProviderApiKeyInput.tsx`). Metron provides **no CORS**, so a browser
   request to metron.cloud can't work — the code correctly disabled client-side
   validation (`PROVIDER_VALIDATORS.METRON = null`) but nothing replaced it. Metron
   credentials were therefore never actually checked; the first sign of trouble was a
   background fetch silently failing, and a filter-ban was indistinguishable from a
   wrong password.

## Prerequisite (already implemented)

`crates/integrations/metadata/src/client.rs` now exposes
`METADATA_USER_AGENT = "Longbox/<crate-version>"` and `default_metadata_client()`.
Both providers (`metron.rs`, `hardcover.rs`) build their client through it, so every
outbound request carries a non-browser UA. Locked in by a wiremock test that fails
without the header.

## Goal

A server-side validation path so the browser never talks to metron.cloud directly,
returning a granular outcome the UI can act on. Triggered two ways:

- **Inline, pre-save** in the create/edit dialog (mirrors the Hardcover flow).
- **On demand** via a "Test connection" button on existing provider cards.

## Non-goals (YAGNI)

- Not changing Hardcover's existing client-side validator.
- No general response-caching layer.
- No local daily-quota (5,000/day) counter — still handled by server 429 + retry.

## Architecture

Provider CRUD is GraphQL (`MetadataProviderMutation` / `MetadataProviderQuery` in
`crates/graphql`), and `metadata_integrations::create_provider(type, token)` already
builds a provider client. Validation slots in as new GraphQL mutations that call a
new provider trait method. Rejected alternatives: a REST route (splits the pattern,
duplicates auth plumbing) and a generic browser→server→Metron proxy (effectively an
SSRF proxy, still needs server-side UA).

### 1. Outcome type — `metadata_integrations::types`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, async_graphql::Enum)]
pub enum ProviderValidationStatus {
    Valid,
    InvalidCredentials,
    Forbidden,
    RateLimited,
    ProviderError,
    NetworkError,
    Unsupported,
}

#[derive(Debug, Clone, async_graphql::SimpleObject)]
pub struct ProviderValidationResult {
    pub status: ProviderValidationStatus,
    pub message: String,
}
```

Exported from `lib.rs`. Mirrors how `MergeStrategy` / `MetadataField` already carry
async-graphql derives and are re-exported for the graphql crate.

### 2. Trait method — `MetadataProvider`

```rust
/// Cheaply verify that the configured credentials work against the provider.
/// Default: providers that don't support server-side validation report Unsupported.
async fn validate_credentials(&self) -> Result<ProviderValidationResult, MetadataProviderError> {
    Ok(ProviderValidationResult {
        status: ProviderValidationStatus::Unsupported,
        message: "This provider does not support server-side validation.".into(),
    })
}
```

Metron overrides it; Hardcover keeps the default (its check stays client-side).

### 3. Metron probe — `MetronClient::validate_credentials`

One authenticated `GET /api/series/?page=1`, read for status only (body discarded),
through the existing 20/min rate limiter but **bypassing the get_json retry path** so
a 429 surfaces immediately rather than blocking on backoff.

| Metron response       | status               | message                                                         |
| --------------------- | -------------------- | --------------------------------------------------------------- |
| `200`                 | `Valid`              | "Credentials verified."                                         |
| `401`                 | `InvalidCredentials` | "Username or password rejected."                                |
| `403` / non-JSON body | `Forbidden`          | "Access denied — account may be filtered, banned, or inactive." |
| `429`                 | `RateLimited`        | "Metron rate limit hit (20/min, 5,000/day). Try again shortly." |
| `5xx`                 | `ProviderError`      | "Metron is having server issues. Try again later."              |
| other 4xx             | `ProviderError`      | "Unexpected response from Metron (HTTP {status})."              |
| connection/timeout    | `NetworkError`       | "Couldn't reach metron.cloud."                                  |

Testability: add a private `base_url: String` field to `MetronClient` (defaulting to
`METRON_API_URL`) plus a `#[cfg(test)]` constructor that overrides it, so wiremock
tests can point at a mock. `new()` keeps its public signature.

### 4. GraphQL mutations — `MetadataProviderMutation`

Both guarded by `PermissionGuard::one(UserPermission::MetadataProviderManage)`, both
delegating to one private helper `run_validation(provider_type_str, token)` that calls
`create_provider(...)?.validate_credentials().await`.

```graphql
validateMetadataProviderCredentials(providerType: MetadataProvider!, apiToken: String!): ProviderValidationResult!
testMetadataProvider(id: Int!): ProviderValidationResult!
```

- `validateMetadataProviderCredentials`: validate raw creds pre-save. Converts the
  `MetadataProvider` enum via `.to_string()` (same string `create_provider` matches).
- `testMetadataProvider`: load the config by id, decrypt with
  `decrypt_string(encrypted_api_token, encryption_key)` (mirrors
  `core::filesystem::metadata::provider_cache`), then validate. Missing token → a
  `ProviderValidationResult { InvalidCredentials, "No API token configured." }`.

### 5. Frontend

- New graphql mutation documents beside the existing `createMetadataProvider`.
- `ProviderApiKeyInput.tsx`: replace `PROVIDER_VALIDATORS.METRON = null` with a
  server-backed validator that calls `validateMetadataProviderCredentials` and maps
  each status to a message. Keep the 500ms debounce; only fire for Metron when the
  value contains `:` so idle typing doesn't burn quota.
- `ExistingProviderCard.tsx`: add a "Test connection" button that calls
  `testMetadataProvider(id)` and shows the returned status/message inline.
- New user-facing strings follow the existing bespoke-literal precedent in
  `ProviderApiKeyInput.tsx` (locale files are another stream's territory this phase).

## Testing

- wiremock unit tests in `metron.rs` for `validate_credentials`: `200 → Valid`,
  `401 → InvalidCredentials`, `403 → Forbidden`, `429 → RateLimited`,
  `500 → ProviderError`, and a connection error → `NetworkError`. Uses the test-only
  base-url constructor — no live API calls.
- Existing `#[ignore]` live tests remain for opt-in smoke runs.
- Frontend: typecheck + lint; the validator's status→message mapping is pure and unit-testable.

## Rate-limit / guideline compliance

- Validation respects the 20/min limiter and does not retry on 429.
- Debounce + `:`-guard keep inline validation from spamming requests.
- All requests carry the mandatory non-browser UA (prerequisite).
- Tests exercise request shaping via mocks, never the live endpoint.
