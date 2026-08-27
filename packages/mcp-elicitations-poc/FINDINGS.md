# MCP Elicitations PoC findings

## Summary

The PoC supports proceeding to an RFC: form-mode multi round-trip request (MRTR) elicitation can replace `confirm_cost` for capable clients, preserve a legacy fallback for other clients, and carry signed state without server-side conversation state; URL-mode secret handling was also exercised with a mock connect page and fake sessions. The RFC must treat the state as readable, require shared single-use enforcement for replay protection, specify fail-closed store behavior and production key management, and define the capability-policy edges. Inspector CLI coverage is insufficient for manual MRTR validation.

Four shipping clients were then driven by hand against the same prompt, which is
[section 7](#7-client-ui-survey-pass). Two of them elicit on their 2025-era
connections, so elicitation is available to clients shipping today and not only to
2026-07-28 ones. The PoC therefore serves three lanes rather than two, described in
[What the PoC added](#what-the-poc-added-to-serve-both-eras). Two clients reach the
modern lane only after the server accepts a mode-less capability declaration, and
Claude Desktop does not support form elicitation at all.

## 1. Happy path: PASS

**Asserted:** [`test/happy-path.test.ts`](test/happy-path.test.ts), suite `create_project MRTR happy path`, proves that acceptance creates exactly one project; decline returns a normal, agent-readable non-error result and creates none; cancellation is distinct from decline; and absent or empty `inputResponses` reissues `input_required` with fresh state and no side effect.

**Surprises and RFC impact:** The exact intermediate wire discriminator is `input_required`. The public `client.callTool()` result omits `resultType`, so the test observes raw HTTP frames. Missing responses are a normal additional round, not an error; the RFC should require fresh state when reissuing.

## 2. Token properties: PASS-WITH-SURPRISES

**Asserted:** [`test/token-properties.test.ts`](test/token-properties.test.ts), suite `requestState token security properties`, rejects a single-character mutation, a decoded-and-re-encoded payload mutation, expiry, redemption by another principal, changed tool arguments, and a payload signed with an attacker key. Each rejection is followed by a successful fresh flow. The suite also proves the contrast: a non-declaring client can precompute the legacy deterministic token and create a project in one call.

**Surprises and RFC impact:** The SDK codec provides HMAC-SHA256 integrity, not AEAD encryption. The test decodes the client-readable body and observes state fields including principal, tool, cost, argument digest, and `jti`; [`NOTES.risk2.md`](NOTES.risk2.md) records the envelope fields too. State must contain no secrets. Expiry uses integer-second boundaries. The RFC should state that MRTR prevents client precomputation only while the signing key remains server-held, and that the legacy path intentionally retains its precompute property.

## 3. Replay residual and dedupe: PASS-WITH-SURPRISES

**Asserted:** [`test/replay-dedupe.test.ts`](test/replay-dedupe.test.ts), suite `requestState replay and jti dedupe`, proves that valid state is replayable within its TTL without a `jti` store; one in-memory store rejects a second redemption; two instances with separate in-memory stores both accept the same state; two instances sharing a store reject the cross-instance replay; and a missing-response round can consume the old `jti`, receive fresh state, and still complete.

**Surprises and RFC impact:** Signed state alone is not single-use. A `jti` policy requires an atomic, shared consumption store across all instances. The shared object in this PoC demonstrates the required semantics, not a production store. Store-outage behavior was not implemented or tested; the RFC must require fail-closed behavior.

## 4. Capability gating: PASS-WITH-SURPRISES

**Asserted:** [`test/capability-gating.test.ts`](test/capability-gating.test.ts), suite `risk 4: capability gating`, proves that a non-declaring client receives only the legacy confirmation flow; a declaring client receives exactly one `$10/month` form request and creates one project after acceptance; the wire discriminator is exactly `input_required`; a precomputed legacy token cannot bypass elicitation for a capable client; and state plus accepted responses minted on a declaring request do not create a project when replayed without the capability.

**Surprises and RFC impact:** Gating is server-side policy based on per-request client metadata, not an automatic SDK rejection: the SDK's own gate is a hard 400 (`-32021`), so a graceful fallback has to be authored. This PoC does it inside the single tool it ships, which is fine at PoC scale but is NOT the shape to carry forward. The approved design puts effective-form-support resolution and authority-path routing in the shared server runtime, so business tools only declare a policy and never inspect capabilities. The current policy prioritizes elicitation for capable clients and ignores a supplied legacy token. A cross-capability redemption is also ignored and returns a fresh legacy confirmation rather than an error. The RFC should make both choices explicit.

## 5. Inspector stretch: PASS

**Asserted/observed:** This risk has no automated test suite. [`NOTES.risk5.md`](NOTES.risk5.md) records two manual Inspector 2.0.0 runs. CLI: connected over Streamable HTTP, listed `create_project`, and negotiated MCP `2026-07-28` when configured with `protocolEra: "modern"`. Web UI (browser-driven follow-up): with the server's Protocol Era set to Modern, `create_project` paused at an "Elicitation Request" modal showing the `$10/month` message, `input_required` tag, and required `confirm` checkbox; accepting completed the MRTR retry and created the mock project (2 rounds, completed).

**Surprises and RFC impact:** The CLI does not advertise form elicitation, so the server correctly falls back to the legacy path; it has no option to advertise the capability or submit a form response, so headless CI needs a capable programmatic client. The web UI completes the form-elicitation MRTR flow end to end, but its Protocol Era defaults to Legacy per server: manual testers must switch it to Modern or they will silently exercise the 2025-era path.

## 6. URL-mode elicitation (secret handling): PASS-WITH-SURPRISES

**Asserted:** [`test/url-happy-path.test.ts`](test/url-happy-path.test.ts), [`test/url-security.test.ts`](test/url-security.test.ts), and [`test/url-lifecycle.test.ts`](test/url-lifecycle.test.ts) prove that a URL-capable client receives a `mode: "url"` request with `url` and no `requestedSchema`; [`src/url-server.ts`](src/url-server.ts) also supplies the required `message`. An accepted retry reissues fresh state for the same opaque interaction ID while pending, then completes after the out-of-band submission, so `accept` records consent to open rather than completion. Two separate claims about secret isolation, deliberately not conflated. **By design:** the result schema contains only an opaque `secret_ref` and no credential-derived field at all, asserted structurally (`not.toHaveProperty('last4')`) and readable in `src/url-server.ts`. **By scan:** no plaintext substring of the sentinel four characters or longer, and no base64, base64url, or URI encoding of the full value or its last eight characters, appears in any captured frame in either direction. The scan is finite: shorter plaintext fragments and untested encodings of arbitrary slices are outside it, so it is regression detection for the design choice, not a proof of absence. The URL contains only the opaque `i` identifier. Missing, unknown, and mismatched mock sessions cannot open or submit Alice's interaction; the URL grants no authority. Repeated pending accepts re-prompt without an error, and decline or cancel remains available. The suites also prove interaction expiry, one-time redemption, and `elicitation.url` gating: form-only and capability-free clients receive `unsupported_client` without seeing a URL request.

**Surprises and RFC impact:** URL-mode completion is application state. The PoC correlates the pending interaction with the principal, then stores the credential by principal and name; MRTR remains stateless because the retry can use echoed signed `requestState` to decide completion. Inspector 2.0.0's web UI renders the full URL, waits for explicit consent, and offers the spec's manual "I've completed it" control without polling. **That full round is now verified by hand (2026-08-03):** clicking "I've completed it" after the out-of-band submission closed the round, returning `Stored API key "openai-key".` with the MRTR conversation settling at 2 rounds complete. The earlier automation-only gap is closed. Form mode was verified the same way, returning `Created project "test_project".` at 2 rounds.

**One observed counterexample to a shared 120 second lifetime.** That manual URL round took about 175 seconds of wall time between round 1 (13:27:30) and round 2 (13:30:25) at an unhurried human pace: open the page, authenticate, locate the key, paste it, return to the client. It survived because the PoC's URL flow uses a 300 second interaction lifetime (`src/url-server.ts:75,81`) against 120 seconds for form mode (`src/server.ts:126`). The approved design pins Continuation State at "120 seconds and cannot be configured above 120 seconds", so this particular run would have expired mid-flow under that cap. This is a single observation, not a measured minimum: it does not establish what the right Secret Collection lifetime is, only that the shared 120 second cap needs a deliberate per-policy decision before Secret Collection could ship. It also reinforces the design's own sequencing, since longer-lived Elicitation state is already blocked until the dedicated request-state secret replaces `JWT_SECRET`.

## 7. Client UI survey: PASS

**Observed:** manual runs on 2026-08-21 against [`src/stdio.ts`](src/stdio.ts), one
server, one prompt payload, four client surfaces. Screenshots and per-client notes:
`~/Work/handoffs/mcp-elicitations/2026-08-21-client-ui-screenshots.md`. Wire evidence:
[`NOTES.claude-code.md`](NOTES.claude-code.md).

| Client | Era | Surface | Outcomes exercised |
|---|---|---|---|
| Claude Code 2.1.226 | 2025-11-25 | inline prompt, `Accept` / `Decline`, `Esc` | created, declined, cancelled |
| Claude Code 2.1.226 | 2026-07-28 | same, labelled `round 1` | created, declined, cancelled |
| Codex CLI v0.149.0 | 2025 | numbered list, `Allow` / `Deny` / `Cancel` | created, declined, cancelled |
| ChatGPT desktop 26.818 | 2025 | GUI card, `Continue` / `Skip` | created |
| Claude Desktop 1.34493.1 | — | no prompt; form elicitation unsupported | legacy token path |

**RFC impact.** Four points the RFC should absorb.

The `message` is the entire design surface, and it is enough: every client rendered
the aligned cost block faithfully, including newlines and column padding. Anything
richer costs the user an extra interaction, because it has to become a schema field.

Action labels diverge across clients over the same three wire values. `decline` reads
as "Decline", "Deny", and "Skip" depending on the client, and `cancel` is reachable in
every client while never being labelled the same way. A server must not attach
distinct meaning to `cancel` versus `decline`, because the distinction is not visible
to the person answering.

Codex reuses its tool-permission widget for elicitation, so a cost confirmation is
visually indistinguishable from a "may this tool run" gate. Consent copy has to carry
the difference on its own.

The model narrating the result cannot see which control the user pressed. In one
Claude Code run, three identical calls answered differently were reported as server
non-determinism. Result text should therefore state the outcome plainly enough that a
model repeating it stays accurate.

## Explicit RFC flags

### SDK API gaps and naming

Observed against `@modelcontextprotocol/server` 2.0.0 and recorded in [`NOTES.md`](NOTES.md):

- The expected helper names `inputRequired`, `acceptedContent`, and `createRequestStateCodec` matched. The client auto-fulfil loop also worked: a handler registered for `elicitation/create` echoes `requestState` and retries with a fresh JSON-RPC id.
- Related actual APIs are `inputResponse(...)`, `codec.mint(...)`, and `ServerOptions.requestState.verify`. `mint` is async. The client option is named `capabilities`, and the SDK serializes it under `_meta["io.modelcontextprotocol/clientCapabilities"]`.
- `acceptedContent(responses, key, schema)` performs schema validation and returns typed content or `undefined`. The typed client form-content index permits only primitive form values, narrower than the harness's `Record<string, unknown>` callback contract; the harness casts at that boundary and the server validates with Zod.
- `createMcpHandler` returns web-standard `{ fetch, close, notify, bus }`; the runnable Node adapter is `toNodeHandler` from `@modelcontextprotocol/node`.
- The codec is HMAC-signed, not AEAD-encrypted. Its payload is client-readable, so state contents must not be secret.

Codec verification failures, including tampering, expiry, and an invalid MAC, surface as JSON-RPC `-32602` with `Invalid or expired requestState`. Principal, argument, and replay-policy failures occur in the tool callback and return an `isError: true` tool result. The former may look like a protocol/request failure to an agent; the latter can carry policy-specific, agent-readable recovery text. The RFC should decide whether this split is acceptable for agent UX.

### Exact discriminator

The observed intermediate `resultType` value is exactly:

```text
input_required
```

This is pinned by `pins the SDK's observed intermediate result discriminator` in [`test/capability-gating.test.ts`](test/capability-gating.test.ts) and also observed in the happy-path suite.

### What Human Confirmation does and does not prove

The PoC proves the server side of the claim and bounds it precisely. Continuation State
verification establishes **integrity and binding**: the state was minted by this server,
has not been tampered with, has not expired, is presented by the same Approver, matches
the same Confirmed Action, and has not already been redeemed on this process. None of
that establishes **human presence**.

MRTR moves the interaction to the client by design, so the client decides whether a human
is involved. Claude Code's MCP documentation describes an `Elicitation` hook that can
return `accept` with form content and skip the dialog, and an `ElicitationResult` hook
that can override a user's response. Default behaviour is interactive, but automation is a
supported client feature, not an abuse of one. This is read from vendor documentation and
was not exercised against this PoC.

Consequences for the RFC and for external wording:

- "The approval cannot be forged or precomputed" is supportable: it is a cryptographic
  property of the state, and the precompute contrast test demonstrates it.
- "A real human approved this" is not supportable from the server alone. It requires an
  explicit trusted-client-policy assumption, and should be worded as approval conveyed
  through a conforming client, which is what the design already says.
- The gap is not closed by the legacy sunset. Capability downgrade and client-side
  auto-answer are separate paths, and only the first is measured by adoption telemetry.
- Asymmetry, stated carefully: form acceptance is a boolean a client can synthesise,
  whereas Secret Collection completion attests that **an authenticated out-of-band write
  occurred**. That is a stronger statement about the side effect, but it is still not
  human presence: a companion process holding a valid session could read a secret from
  the environment or a keychain and POST it to the connect endpoint without a person and
  without exposing it to the model. Moving the interaction out of band does not by itself
  produce attested human approval. That requires an explicit human-presence control on
  the page, such as reauthentication or a WebAuthn step-up, which nothing in this PoC
  implements or tests.

### Legacy-era clients already elicit

**Asserted:** elicitation is not a 2026-07-28 feature waiting on client adoption. Both
2025-era clients tested here already support it. Claude Code 2.1.226 initialized with
protocol version `2025-11-25` and classic `capabilities.elicitation = {}`, sent no
`server/discover` probe, and rendered a prompt when the server pushed one. Codex CLI
v0.149.0 did the same on its 2025 connection. What reaches those clients is the
2025-era push: a server-to-client `elicitation/create` request answered inline, not an
`input_required` result. [`test/classic-elicitation.test.ts`](test/classic-elicitation.test.ts)
covers that path against the wire shape they send, and
[section 7](#7-client-ui-survey-pass) has the screenshots.

So the choice is not elicitation for modern clients and a token for everyone else. A
deployment can elicit from today's clients, and the RFC should say so.

There is a deployment catch, and it decides which fallback the RFC can promise.
Stateless legacy HTTP cannot push a 2025-era elicitation at all: with
`createMcpHandler`'s default `legacy: 'stateless'` posture, the instance that answers
`tools/call` never saw `initialize`, so it cannot know the client declared
`elicitation`, and the client lands in the deterministic `confirm_cost_token` path in
[`src/server.ts`](src/server.ts).

A 2025-era elicitation path therefore needs connection-scoped server state.
[`src/stdio.ts`](src/stdio.ts) supplies it with `serveStdio(factory)`: one pinned
instance per connection, `getClientCapabilities()` readable at tool-call time, and
`ctx.mcpReq.elicitInput` available to push `elicitation/create`. A sessionful HTTP
wiring would be the deployed equivalent, which this PoC did not build.

**Observed:** a manual Claude Code session completed the classic round three times
against [`src/stdio.ts`](src/stdio.ts): one accept that created the project, and two
declines. Claude Code renders the request inline in its transcript with a heading, the
server's `message`, one row per schema property, and `Accept` / `Decline` actions.
[`NOTES.claude-code.md`](NOTES.claude-code.md) records the trace and the UI shape.

One consequence belongs in the RFC. Claude Code validates `requestedSchema` before it
submits, so `Accept` with an untouched required boolean is refused client-side with
`This field is required` and nothing reaches the server. Ticking the box and unticking
it leaves an explicit `false`, which `Accept` does submit: on the 2026-07-28 era that
arrived as `accept` with `confirm: false`. Consent therefore lives in the content, not
in `action`, and a server that reads `accept` as approval approves a refusal.

That is an argument about schema shape, and it points at a recommendation. A cost
confirmation is one yes-or-no, and a required boolean makes the user set a field and
then press `Accept` for the same answer. The PoC now sends
`{"type":"object","properties":{}}` and reads consent from `action`, which removes the
field, the client-side validation, and the `accept`-with-`false` ambiguity together.
The cost breakdown moves into `message`, the only part of the prompt a server
formats. Multi-line messages survive the wire on both eras.

**Also observed, on the 2026-07-28 era:** with
`MCP_SDK_GENERATION=v2 MCP_PROTOCOL_NEGOTIATION=auto`, Claude Code negotiates
`2026-07-28`, declares a mode-less `elicitation: {}`, carries that declaration in each
request envelope, and completes the MRTR round: `input_required`, then a second
`tools/call` echoing `requestState` with the response, twice over, one refusal and one
creation.

The mode is the flag for the RFC. A declaration of `elicitation: {}` names no mode, so
a server gating on `elicitation.form` downgrades a client that renders forms, and the
PoC only reached the form lane once it read a mode-less declaration as form capable.
The SDK reads it the same way at the emit gate, which refuses only when the envelope
declares no elicitation at all (`-32021`, naming
`{"elicitation":{"form":{}}}`). The RFC should state what a mode-less declaration
means, and whether a server may treat an opening declaration as binding for the
connection: one earlier v2 session sent envelopes with no elicitation at all and was
downgraded, which is what `restoreDeclaredElicitation` in
[`src/stdio.ts`](src/stdio.ts) repairs.

### What the PoC added to serve both eras

Everything above is served by one tool and one factory. The routing lives in `lane()`
in [`src/server.ts`](src/server.ts), which reads the era from the per-request envelope
and picks between three exits.

| Lane | Reached by | Mechanism |
|---|---|---|
| `form` | modern era declaring elicitation, mode-less or `form` | `inputRequired.elicit`, signed `requestState`, two tool calls |
| `classic` | 2025-era connection declaring `elicitation` | `ctx.mcpReq.elicitInput` pushes `elicitation/create`, one tool call, no state minted |
| `legacy` | anything else | deterministic `confirm_cost_token`, unchanged from the original flow |

The pieces that made the two elicitation lanes reachable:

- `createPocServerFactory` in [`src/server.ts`](src/server.ts) exposes the tool logic as
  a factory, so the same registration serves `createMcpHandler` per request and a
  pinned STDIO connection.
- [`src/stdio.ts`](src/stdio.ts) is that pinned entry: `serveStdio(factory)`, plus
  `restoreDeclaredElicitation` for a client that declares only at its opening exchange.
- `isFormCapable` in [`src/client-capabilities.ts`](src/client-capabilities.ts) treats a
  mode-less `elicitation: {}` as form capable, which is what shipping clients send.
- The classic lane's pushed request carries the same `message` and schema as the modern
  lane, so the two eras cannot drift in what the user is asked. Its request timeout
  defaults to 600s, because a human reading a cost prompt is slower than a default.
- [`src/trace.ts`](src/trace.ts) narrates the chosen lane, the negotiated protocol, and
  the declared capabilities to stderr and `POC_TRACE_FILE`. Principals are logged as a
  digest prefix, never as the bearer token.

Not built: a sessionful HTTP wiring, which is what a deployed server would need to
offer the classic lane over HTTP rather than STDIO.

### Design consequences

- State-in-token works without server-side conversation state. [`src/server.ts`](src/server.ts) embeds version, principal, tool, argument digest, cost, `jti`, and issue time; the codec adds expiry and method binding.
- Single-use `jti` enforcement requires an atomic shared consumption store in multi-instance deployments. The two-instance tests prove the gap and the shared-store semantics.
- Fail-closed behavior during consumption-store outage was not implemented here. The RFC must specify it.
- The PoC key comes from `POC_STATE_KEY` or one random per-process value. Production needs a real server-held secret and a rotation design. All instances that redeem the same state need compatible keys during rotation.
- Inspector CLI can negotiate `2026-07-28` but sends no form-elicitation capability and therefore exercises only the legacy path. The web UI completes the form MRTR flow end to end (verified against this PoC); its per-server Protocol Era defaults to Legacy and must be set to Modern.
- URL mode requires application storage for pending-interaction correlation and for the credential bound to its principal. The real connect page must derive that principal from an authenticated dashboard session and compare it with the interaction record; the PoC cookie is only a fake session.
- The RFC must decide whether any credential fingerprint belongs in a tool result. It can help a user identify a stored key, but it exposes credential material to model context, transcripts, and logs.
- This application state is not an MRTR transport requirement. MRTR remains stateless, and the server can decide completion from the signed `requestState` echoed by the client.

## Scope

The PoC's tests are fully mocked, but an env-gated opt-in adapter (`MANAGEMENT_API_URL`/`MANAGEMENT_API_TOKEN`, restricted to HTTPS and `*.supabase.green` hosts) was added for manual staging validation; it is off by default and exercised only by stubbed-fetch tests. URL-mode elicitation used a mock connect page, a cookie-based fake session, and in-memory interaction and secret stores. It did not use a real Supabase auth session, a real secret manager, a dashboard-hosted page, or a third-party OAuth flow. Legacy stateful transports were out of scope. Only project creation at $10/month was exercised; branch pricing at $0.01344/hour was not. This package pins SDK 2.0.0, while the rest of the PR #327 base monorepo remains on 2.0.0-beta.3.
