# Risk 3: requestState replay and jti dedupe

## Test outcomes

- **Replay residual:** With no jti store, the same accepted retry creates the
  project twice. A valid requestState is replayable within its TTL.
- **In-memory dedupe:** A single `InMemoryJtiStore` accepts the first redemption,
  rejects the second as a replay, and leaves one project in the registry.
- **Multi-instance gap:** Two instances with the same state key but separate
  in-memory stores each accept the same requestState. In-memory dedupe therefore
  protects only one instance.
- **Shared-store fix:** Two instances sharing one jti store reject the replay on
  the second instance. The shared in-memory object stands in for a durable shared
  store such as Redis.
- **Re-issue boundary:** With dedupe enabled, a retry missing `inputResponses`
  consumes its current jti and receives a fresh requestState. That fresh state can
  still be completed, so legitimate multi-round flows are not blocked.

## RFC recommendation

Production deployments should use a shared jti consumption store and fail closed
when that store is unavailable. The PoC demonstrates shared-store semantics, but
does not implement or test fail-closed behavior on store outage.
