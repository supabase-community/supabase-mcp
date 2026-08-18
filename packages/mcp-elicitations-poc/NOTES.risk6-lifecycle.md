# Risk 6: URL lifecycle

## Outcomes

- A pending accept returns `input_required`. Each retry has fresh request state and the same interaction ID.
- Three pending accepts succeed without an error. The fourth accept stores the completed secret.
- A missing `provide_api_key` response and an empty response map both reissue the request.
- An expired connect page returns HTTP 404 with `Interaction not found or expired.`
- An accepted retry after expiry returns `isError: true`, status `error`, and `The interaction is missing or expired.`
- A new flow succeeds after an expired retry. The server does not remain blocked.
- A byte-identical completing retry returns `isError: true`, status `error`, and `The interaction replay was rejected.`
- The replay keeps the first secret reference. The store has one value for the principal and name.
- `InMemoryInteractionStore.consume(id)` returns `true` once and then returns `false`.
- Form-only and capability-free clients receive status `unsupported_client`.
- Both clients receive `A browser-capable client that declares URL elicitation is required.`
- Those clients receive no `inputRequests` or URL-mode request on the wire.
- A URL-capable request contains `mode: url` and a URL. It has no `requestedSchema`.

## Driver limit

The lifecycle tests use raw calls for precise request-state checks. Three re-prompt rounds pass, and no SDK driver cap applies.

## Cross-capability state

A form-only client can present valid state from a URL-capable call. The server checks current capabilities first and returns `unsupported_client`.

The result is a normal tool result. It has no `isError: true`, and it does not store a secret.

## Client driver round cap (verified 2026-08-03)

The installed stable client DOES have an auto-fulfil round cap, so earlier wording
implying uncertainty about its existence was wrong:

- `@modelcontextprotocol/client` 2.0.0 (the version this package resolves; a beta.3 copy
  also sits in the pnpm store for the base-branch packages)
- `dist/src-D_zzAWoS.mjs:5049` — `const DEFAULT_INPUT_REQUIRED_MAX_ROUNDS = 10;`
- exceeding it throws `SdkError(InputRequiredRoundsExceeded)` with the message
  "Multi-round-trip request '<method>' still required input after <n> rounds
  (inputRequired.maxRounds)"

What the lifecycle suite exercised: three re-prompt rounds via RAW calls, which bypass the
driver entirely, so the cap was never hit here. What remains unknown is therefore not
whether a cap exists, but whether a given harness uses this driver and its default, and
how it surfaces exhaustion to the user.

Keep two mechanisms distinct when reasoning about URL mode:

- **Manual completion** (what Inspector implements): the client waits for a human signal
  ("I've completed it") and then retries once. Round usage stays at 2 in the observed run.
- **Auto-polling** (hypothetical): a client that retries on a timer consumes one round per
  poll and would hit the cap after 10, failing the call rather than waiting. Any harness
  choosing this needs a poll interval reconciled against the interaction lifetime.
