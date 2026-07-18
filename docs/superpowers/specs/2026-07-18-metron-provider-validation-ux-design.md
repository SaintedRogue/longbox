# Metron Provider Validation UX — Design

Date: 2026-07-18
Status: Design approved + revised (Forbidden→red; username/password split added); implementing

## Goal

Make the metadata-provider credential form tell the user **which kind** of failure they
hit, instead of painting every failure as a wrong password, and let them **see the
username/password they entered** so a typo/truncation is catchable before saving.

Today a network/IP problem, a rate-limit, a bot-filter, and an actual bad password are
visually identical — all render as one red error on the password field. And Metron's
credentials are crammed into a single masked `username:password` field, which is how a
production password silently lost its last character. This change splits failure feedback
by kind and splits the Metron input into a visible Username + a revealable Password.

This directly resolves the reported confusion: on a production box whose egress IP is
firewall-banned by Metron, the server's validation `NetworkError`s after a ~10s hang, and
the UI labels that as a password error — so a correct password looks wrong.

## Non-goals

- **No backend or GraphQL changes.** The `validateMetadataProviderCredentials` mutation
  already returns `{ status, message }`, and `ProviderValidationStatus` is already imported
  in the web app. This is a frontend-only change (CI gates: `yarn lint` / `yarn test`).
- **Not** changing the trigger model beyond the composition tweak below: debounced
  auto-validation and the 500ms debounce stay.
- **Not** touching credential storage: Metron creds are still composed to
  `username:password` and encrypted into the single `encrypted_api_token` column. The split
  is purely a form-presentation concern; the wire/DB shape is unchanged.
- **Not** applying the two-field split to Hardcover (it uses a single opaque token, not
  basic auth).

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
that distinction, and on success affirms nothing (only clears the error), so the user
cannot tell "verified" from "not yet checked." Separately, the single masked `user:pass`
field makes entry errors invisible.

## Approach — validation feedback

Route each status to one of three channels; the server `message` remains the single source
of truth for human-readable text.

Structure (pure mapping + presentational component):

- **`providerValidationFeedback.ts`** — pure `metronStatusToFeedback(status, message)`
  returning `{ severity: 'success' | 'warning' | 'error', asFieldError: boolean, title:
string, description: string, hint?: string }`. No React, unit-testable.
- **`ProviderValidationFeedback.tsx`** — renders a `Feedback`: a green success line, or an
  `Alert` whose variant follows `severity` (`error` → destructive/red, `warning` → amber),
  reusing `@longbox/components` `Alert`/`AlertTitle`/`AlertDescription`.
- **`ProviderApiKeyInput.tsx`** — orchestrator: holds `feedback` state, calls the mapping,
  decides field-error vs. callout vs. success.

### Status → treatment mapping

| Status               | Channel                 | Severity        | asFieldError | Copy source                                                                                                                                            |
| -------------------- | ----------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Valid`              | inline success on field | success (green) | no           | literal "Verified"                                                                                                                                     |
| `InvalidCredentials` | **field error (red)**   | error           | **yes**      | server message ("Username or password rejected.")                                                                                                      |
| `Forbidden`          | callout                 | **error (red)** | no           | server message + hint: account may be filtered/banned/inactive; check the account email is verified. Not a password problem                            |
| `NetworkError`       | callout                 | warning (amber) | no           | server message + hint: connectivity/IP, not credentials — if this server's IP is blocked by Metron, validation fails here even with a correct password |
| `RateLimited`        | callout                 | warning (amber) | no           | server message (transient — try again shortly)                                                                                                         |
| `ProviderError`      | callout                 | warning (amber) | no           | server message (transient — provider server issue)                                                                                                     |
| `Unsupported`        | none                    | —               | no           | render nothing (not reachable for Metron)                                                                                                              |

Decisions:

- The **field-error (red field)** channel is reserved for `InvalidCredentials` alone — it is
  the only status that means "your password is wrong."
- `Forbidden` is **red** (destructive callout) — it is a serious, action-required state
  (account filtered/banned/inactive), distinct from the transient amber warnings — but it is
  a **callout, not a field error**, because the password may be correct; the problem is
  account/access, so it must not imply "re-type your password."
- `NetworkError` carries the IP-ban hint (the exact failure a blocked self-hoster hits).

### State & flow

Add one `feedback: Feedback | null` state (`useState`; react-compiler-safe). On each result:

- `Valid` → `clearErrors('apiToken')`; `feedback = { severity: 'success', title: 'Verified' }`
- `InvalidCredentials` → `setError('apiToken', message)`; `feedback = null`
  (field turns red with the message; no duplicate callout)
- any other status → `clearErrors('apiToken')`; `feedback = metronStatusToFeedback(...)`
- new keystroke / empty value → reset `feedback` to `null`
- while `isPending` → subtle "Checking…" affordance (no error styling)

`fetchError` (our own server/GraphQL unreachable — distinct from provider `NetworkError`)
keeps its existing dedicated `Alert` block. **Hardcover** reuses the success path (green
"Verified" on pass; today's `setError` on fail).

## Approach — Metron username/password split

For Metron only, replace the single masked `user:pass` `PasswordInput` with two inputs:

- **Username** — a plain visible `Input` (basic-auth username, safe to show).
- **Password** — a `PasswordInput`, which already has a built-in reveal (eye) toggle.

The form keeps a single `apiToken` field as its source of truth (schema and submit path
unchanged). The two inputs compose it: on change, `apiToken = \`${username}:${password}\``via`form.setValue('apiToken', …, { shouldValidate: true })`. When editing an existing
config where `apiToken`is pre-seeded, split it back on the **first** colon to populate the
two inputs. Composition is lossless because the backend parses with`split_once(':')` (first
colon only), so a colon inside the password is preserved; only the username must be
colon-free (Metron usernames are).

Validation fires once **both** username and password are non-empty (replacing the current
"value contains `:`" guard, which `rogue:` alone would wrongly satisfy). Hardcover keeps its
single-field rendering.

## i18n

Metron's new hint/label copy is added as **inline literals**, matching the existing pattern
in this file. Strings are centralized in `providerValidationFeedback.ts` (feedback) and the
component (field labels), easy to lift to locale keys later.

## Testing

- **`providerValidationFeedback.test.ts`** (jest) — one assertion per status verifying
  `severity` and `asFieldError`. Critical invariants: `asFieldError === true` **iff**
  `InvalidCredentials`; `Forbidden` and `InvalidCredentials` are both `error` severity while
  `NetworkError`/`RateLimited`/`ProviderError` are `warning`; the server `message` is
  preserved in `description`.
- **Compose/split** unit coverage for the username+password ⇄ `apiToken` helpers
  (`compose('rogue','a:b') === 'rogue:a:b'`; `split('rogue:a:b') === ['rogue','a:b']`).
- Existing `yarn lint` (eslint + prettier + check-types, incl. eslint-plugin-react-compiler)
  and `yarn test` gates cover component wiring.

## Deferred

None outstanding — the earlier deferred items (two-field split, password reveal) are now in
scope. The reveal toggle itself already exists in `PasswordInput`; the split makes it useful
by giving the password its own field.
