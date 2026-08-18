# Risk 2: token-property outcomes

Results are recorded from the package-scoped `token-properties` test suite.

| Property | Outcome | Observed rejection surface and message |
| --- | --- | --- |
| Middle-character tampering | Pass | JSON-RPC error `-32602`: `Invalid or expired requestState` |
| Decode, alter, and re-encode payload | Pass | JSON-RPC error `-32602`: `Invalid or expired requestState` |
| Expired state (`ttlSeconds: 1`, checked after 2.1 seconds) | Pass | JSON-RPC error `-32602`: `Invalid or expired requestState` |
| Different principal | Pass | Tool result with `isError: true`: `Request state principal does not match the current principal.` |
| Different arguments | Pass | Tool result with `isError: true`: `Request state arguments do not match the current arguments.` |
| Payload signed with attacker key | Pass | JSON-RPC error `-32602`: `Invalid or expired requestState` |
| Legacy token precomputed without a server round trip | Pass, expected contrast | No rejection. A non-declaring client creates the project in one call. |

Every rejection case also mints a fresh state and successfully creates a project
afterward. A rejected token therefore does not wedge the server.

## Payload visibility

The `v1.<body>.<mac>` body is base64url JSON and was decoded client-side. Its
application payload is under `p`; `sub`, `tool`, `argsDigest`, `cost`, `jti`,
and `iat` are readable. The envelope also exposes `exp` and the method-binding
tag `b`. This confirms the state is signed, not encrypted. Confidential values
must not be placed in it.

The expiry comparison has integer-second boundary behavior. A 1.5-second wait
can still land on the accepted boundary for a one-second TTL, so the stable test
waits 2.1 seconds.

## RFC design impact

The signed MRTR state prevents the `confirm_cost` precompute attack because a
client cannot produce a valid MAC without the server key. The legacy fallback
retains that attack by design: its confirmation token is a deterministic,
publicly computable digest and can be supplied on the first request.

The RFC should state both points explicitly: request state provides integrity,
not confidentiality, and retaining the legacy path retains the precompute
property for clients that use it. No server or harness gaps blocked these
assertions.
