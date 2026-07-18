# Metron Provider Validation UX — Design

Date: 2026-07-18
Status: Design approved (interaction model + scope chosen); pending spec review

## Goal

Make the metadata-provider credential form tell the user **which kind** of failure they
hit, instead of painting every failure as a wrong password. Today a network/IP problem, a
rate-limit, a bot-filter, and an actual bad password are visually identical — all render as
one red error on the password field. Split them so that only a genuine authentication
failure (`InvalidCredentials`) marks the field wrong; connectivity/service conditions read
as "we couldn't verify — not your credentials"; and a success shows a positive **Verified**
confirmation (which neither provider shows today).

This directly resolves the reported confusion: on a production box whose egress IP is
firewall-banned by Metron, the server's validation `NetworkError`s after a ~10s hang, and
the UI labels that as a password error — so a correct password looks wrong.

## Non-goals

- **No backend or GraphQL changes.** The `validateMetadataProviderCredentials` mutation
  already returns `{ status, message }`, and `ProviderValidationStatus` is already imported
  in the web app. This is a frontend-only change (CI gates: `yarn lint` / `yarn test`).
- **Not** changing the trigger model: debounced auto-validation, the 500ms debounce, and
  the "only fire once the value contains `:`" guard for Metron all stay as-is.
- **Not** splitting Metron's single `username:password` field into two inputs. That would
  have prevented the original dropped-character truncation, but it is an input-restructuring
  change out of scope for this feedback-focused fix. Flagged as the natural follow-up.
- **Not** adding a password reveal/show toggle (optional; see "Deferred" below).
- **Not** touching credential storage: Metron creds remain `username:password` encrypted
  into the single `encrypted_api_token` column.

## Problem being solved

In `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderApiKeyInput.tsx`,
the Metron branch of the validation mutation funnels every non-`Valid` result into a single
field error:

```js
if (result.status === ProviderValidationStatus.Valid) {
	form.clearErrors('apiToken')
} else {
	// NetworkError, RateLimited, Forbidden, ProviderError, InvalidCredentials ALL land here:
	form.setError('apiToken', { type: 'validate', message: result.message })
}
```

The backend already distinguishes seven statuses
(`crates/integrations/metadata/src/types/validation.rs:12-28`): `Valid`,
`InvalidCredentials`, `Forbidden`, `RateLimited`, `ProviderError`, `NetworkError`,
`Unsupported`, and returns a tailored `message` per status
(`crates/integrations/metadata/src/providers/metron.rs:280-325`). The frontend discards
that distinction by treating all of them as a password-field error. On success, neither
provider affirms anything — it only clears the error — so the user cannot tell "verified"
from "not yet checked."

## Approach

Reserve the red **field-error channel for `InvalidCredentials` only**. Every other status
routes to one of two other channels: a positive inline **success** indicator (`Valid`), or a
non-credential **callout** (amber warning) that carries the server message plus an optional
hint. The classification is a pure function of the status; the server `message` stays the
single source of truth for the human-readable text.

Structure (chosen option "B" — pure mapping + presentational component):

- **`providerValidationFeedback.ts`** — pure `metronStatusToFeedback(status, message)`
  returning a plain object:
  `{ severity: 'success' | 'warning', asFieldError: boolean, title: string, description: string, hint?: string }`.
  No React, unit-testable in isolation.
- **`ProviderValidationFeedback.tsx`** — presentational component that renders a `Feedback`
  as a success line or an `Alert` (reusing `@longbox/components` `Alert`/`AlertTitle`/
  `AlertDescription`, already imported in this scene).
- **`ProviderApiKeyInput.tsx`** — orchestrator: holds `feedback` state, calls the mapping,
  decides field-error vs. callout vs. success, renders `<ProviderValidationFeedback>`.

## Status → treatment mapping

| Status               | Channel                 | Severity        | asFieldError | Copy source                                                                                                                                            |
| -------------------- | ----------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Valid`              | inline success on field | success (green) | no           | literal "Verified"                                                                                                                                     |
| `InvalidCredentials` | **field error (red)**   | error           | **yes**      | server message ("Username or password rejected.")                                                                                                      |
| `NetworkError`       | callout                 | warning (amber) | no           | server message + hint: connectivity/IP, not credentials — if this server's IP is blocked by Metron, validation fails here even with a correct password |
| `Forbidden`          | callout                 | warning (amber) | no           | server message + hint: account may be filtered/banned/inactive; check the account email is verified. Not a password problem                            |
| `RateLimited`        | callout                 | warning (amber) | no           | server message (transient — try again shortly)                                                                                                         |
| `ProviderError`      | callout                 | warning (amber) | no           | server message (transient — provider server issue)                                                                                                     |
| `Unsupported`        | none                    | —               | no           | render nothing (not reachable for Metron)                                                                                                              |

Decision: `Forbidden` is an **amber warning**, not a red field error — it is ambiguous
(bot-filter / IP / account state), so it must not read as "your password is wrong," but its
hint tells the user to check account status. `NetworkError` carries the IP-ban hint because
that is the exact failure a self-hoster behind a blocked IP hits.

## State & flow

Add one `feedback: Feedback | null` state (`useState`, compatible with react-compiler —
state, not ref). On each validation result:

- `Valid` → `clearErrors('apiToken')`; `feedback = { severity: 'success', ... }`
- `InvalidCredentials` → `setError('apiToken', message)`; `feedback = null`
  (field turns red and shows the message; no duplicate callout)
- any other status → `clearErrors('apiToken')`; `feedback = metronStatusToFeedback(...)`
  (field is **not** red; the callout explains)
- new keystroke / empty value → reset `feedback` to `null`
- while `isPending` → subtle "Checking…" affordance (no error styling)

`fetchError` (our own server/GraphQL unreachable — distinct from the provider's
`NetworkError`) keeps its existing dedicated `Alert` block.

**Hardcover** reuses the same success path: on a passing client-side validation, set
`feedback = { success }` (green "Verified"); on failure it keeps today's `setError`
behavior. This delivers the "shared success state" scope decision without giving Hardcover
Metron's status machinery (its client-side validator returns pass/fail, not granular
statuses).

## i18n

Metron's new hint/label copy is added as **inline literals**, matching the existing pattern
in this file (the current Metron description is a literal with a comment that locale keys
are another stream's territory). If locale keys are preferred later, the strings are
centralized in `providerValidationFeedback.ts` and easy to lift.

## Testing

- **`providerValidationFeedback.test.ts`** (jest) — one assertion per status verifying
  `severity` and `asFieldError` (the critical invariant: `asFieldError === true` **iff**
  status is `InvalidCredentials`), plus that the server `message` is preserved in
  `description`.
- Existing `yarn lint` (eslint + prettier + check-types, incl. eslint-plugin-react-compiler)
  and `yarn test` gates cover the component wiring.

## Deferred (flagged, not in this change)

- Split Metron into separate **username** + **password** inputs (prevents the dropped-char
  truncation at the source).
- Password **reveal toggle** so a user can eyeball a typo before saving.

Both are small, additive follow-ups; either can be pulled forward on request.
