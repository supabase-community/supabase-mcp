# MCP Elicitations PoC

Standalone proof of concept for MCP 2026-07-28 form-mode multi round-trip
elicitation around mock project cost confirmation.

From the repository root:

```sh
pnpm install
```

Run the server from the repository root:

```sh
POC_STATE_KEY="at-least-32-bytes-of-development-key" \
  pnpm --filter @supabase/mcp-elicitations-poc dev
```

Run the tests:

```sh
pnpm --filter @supabase/mcp-elicitations-poc test
```

The development server listens at `http://localhost:3900/mcp`. All project
operations use an in-memory mock registry.

Set `POC_STATE_KEY` to the same value (at least 32 bytes) when multiple
development instances need to accept each other's request states. Otherwise,
the PoC generates one random key per process.

See [FINDINGS.md](FINDINGS.md) for the RFC findings. Supporting observations are
in [NOTES.md](NOTES.md), [NOTES.risk2.md](NOTES.risk2.md),
[NOTES.risk3.md](NOTES.risk3.md), [NOTES.risk4.md](NOTES.risk4.md), and
[NOTES.risk5.md](NOTES.risk5.md).
