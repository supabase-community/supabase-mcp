# MCP Elicitations PoC findings

## Summary

The PoC supports proceeding to an RFC: form-mode multi round-trip request (MRTR) elicitation can replace `confirm_cost` for capable clients, preserve a legacy fallback for other clients, and carry signed state without server-side conversation state. The RFC must treat the state as readable, require shared single-use enforcement for replay protection, specify fail-closed store behavior and production key management, and define the capability-policy edges. Inspector CLI coverage is insufficient for manual MRTR validation.

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

**Surprises and RFC impact:** Gating is handler policy based on per-request client metadata, not an automatic SDK rejection. The current policy prioritizes elicitation for capable clients and ignores a supplied legacy token. A cross-capability redemption is also ignored and returns a fresh legacy confirmation rather than an error. The RFC should make both choices explicit.

## 5. Inspector stretch: PASS

**Asserted/observed:** This risk has no automated test suite. [`NOTES.risk5.md`](NOTES.risk5.md) records two manual Inspector 2.0.0 runs. CLI: connected over Streamable HTTP, listed `create_project`, and negotiated MCP `2026-07-28` when configured with `protocolEra: "modern"`. Web UI (browser-driven follow-up): with the server's Protocol Era set to Modern, `create_project` paused at an "Elicitation Request" modal showing the `$10/month` message, `input_required` tag, and required `confirm` checkbox; accepting completed the MRTR retry and created the mock project (2 rounds, completed).

**Surprises and RFC impact:** The CLI does not advertise form elicitation, so the server correctly falls back to the legacy path; it has no option to advertise the capability or submit a form response, so headless CI needs a capable programmatic client. The web UI completes the form-elicitation MRTR flow end to end, but its Protocol Era defaults to Legacy per server: manual testers must switch it to Modern or they will silently exercise the 2025-era path.

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

### Design consequences

- State-in-token works without server-side conversation state. [`src/server.ts`](src/server.ts) embeds version, principal, tool, argument digest, cost, `jti`, and issue time; the codec adds expiry and method binding.
- Single-use `jti` enforcement requires an atomic shared consumption store in multi-instance deployments. The two-instance tests prove the gap and the shared-store semantics.
- Fail-closed behavior during consumption-store outage was not implemented here. The RFC must specify it.
- The PoC key comes from `POC_STATE_KEY` or one random per-process value. Production needs a real server-held secret and a rotation design. All instances that redeem the same state need compatible keys during rotation.
- Inspector CLI can negotiate `2026-07-28` but sends no form-elicitation capability and therefore exercises only the legacy path. The web UI completes the form MRTR flow end to end (verified against this PoC); its per-server Protocol Era defaults to Legacy and must be set to Modern.

## Scope

The PoC's tests are fully mocked, but an env-gated opt-in adapter (`MANAGEMENT_API_URL`/`MANAGEMENT_API_TOKEN`, restricted to HTTPS and `*.supabase.green` hosts) was added for manual staging validation; it is off by default and exercised only by stubbed-fetch tests. URL-mode elicitation and legacy stateful transports were out of scope. Only project creation at $10/month was exercised; branch pricing at $0.01344/hour was not. This package pins SDK 2.0.0, while the rest of the PR #327 base monorepo remains on 2.0.0-beta.3.
