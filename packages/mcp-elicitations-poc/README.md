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

The development server listens at `http://localhost:3900/mcp`. By default,
project operations use an in-memory mock registry. Setting both staging
Management API variables enables real project creation instead.

## Optional: real staging creation

Set both required Management API variables to create projects on staging:

```sh
MANAGEMENT_API_URL="https://api.supabase.green" \
MANAGEMENT_API_TOKEN="<staging PAT>" \
MANAGEMENT_API_REGION="us-east-1" \
POC_STATE_KEY="at-least-32-bytes-of-development-key" \
  pnpm --filter @supabase/mcp-elicitations-poc dev
```

`MANAGEMENT_API_REGION` is optional and defaults to `us-east-1`.

**Warning: this creates real projects on the target host. It is intended for
staging (`supabase.green`) only, never production.** Mock mode applies when
neither `MANAGEMENT_API_URL` nor `MANAGEMENT_API_TOKEN` is set, and the server
prints an explicit mock-mode startup line. Setting exactly one variable prints
an error and exits with status 1.

**Replay protection: when staging variables are set, the development server uses
an in-memory `jti` store and rejects replay of an accepted request. This enforces
single use within one server instance.** The duplicate-POST residual applies to
store-less deployments (mock mode by default) and multi-instance deployments
without a shared store. See [FINDINGS.md risk 3](FINDINGS.md#3-replay-residual-and-dedupe).

Set `POC_STATE_KEY` to the same value (at least 32 bytes) when multiple
development instances need to accept each other's request states. Otherwise,
the PoC generates one random key per process.

See [FINDINGS.md](FINDINGS.md) for the RFC findings. Supporting observations are
in [NOTES.md](NOTES.md), [NOTES.risk2.md](NOTES.risk2.md),
[NOTES.risk3.md](NOTES.risk3.md), [NOTES.risk4.md](NOTES.risk4.md), and
[NOTES.risk5.md](NOTES.risk5.md).

## URL-mode PoC

The same `dev` command starts a separate URL-mode MCP endpoint at
`http://localhost:3902/mcp`. Its connect page runs at
`http://localhost:3901/connect`.

The connect page uses a mock `poc_session=<principal>` cookie. This cookie stands
in for a dashboard session and provides no production authentication.
