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

`POC_STATE_TTL_SECONDS` overrides the request-state lifetime (120s in form mode,
300s for URL-mode interactions). Raise it for a manual run that pauses on an
elicitation UI. Both servers print a trace of each round on stderr, and also
append it to `POC_TRACE_FILE` when that variable is set.

See [FINDINGS.md](FINDINGS.md) for the RFC findings. Supporting observations are
in [NOTES.md](NOTES.md), [NOTES.risk2.md](NOTES.risk2.md),
[NOTES.risk3.md](NOTES.risk3.md), [NOTES.risk4.md](NOTES.risk4.md),
[NOTES.risk5.md](NOTES.risk5.md), and
[NOTES.claude-code.md](NOTES.claude-code.md).

## URL-mode PoC

The same `dev` command starts a separate URL-mode MCP endpoint at
`http://localhost:3902/mcp`. Its connect page runs at
`http://localhost:3901/connect`.

The connect page uses a mock `poc_session=<principal>` cookie. This cookie stands
in for a dashboard session and provides no production authentication.

## Manual Claude Code run

Use the STDIO entry for Claude Code, on either era. One server instance stays
pinned to the connection, which is what lets the tool see what the client
declared when it opened. The HTTP entry serves 2025-era requests statelessly, so
those capabilities are gone by the time `create_project` runs and the client
lands in the `confirm_cost_token` path.

Default Claude Code 2.1.226 connects on the 2025 era and the server pushes an
`elicitation/create` request. With `MCP_SDK_GENERATION=v2
MCP_PROTOCOL_NEGOTIATION=auto` it negotiates `2026-07-28`, declares
`elicitation: {}` once at `server/discover`, and then sends an empty capability
object per request; [`src/stdio.ts`](src/stdio.ts) restores that declaration
into each envelope so the MRTR path stays reachable. See
[NOTES.claude-code.md](NOTES.claude-code.md) for the wire evidence.

From the repository root, register the STDIO server. Claude Code spawns the
command with its own working directory, so the paths must be absolute. Invoke
`tsx` directly: `pnpm run` prints a banner on stdout, which would corrupt the
protocol stream.

```sh
POC=$PWD/packages/mcp-elicitations-poc
claude mcp add poc-elicit -e POC_TRACE_FILE=/tmp/poc-trace.log -- \
  "$POC/node_modules/.bin/tsx" "$POC/src/stdio.ts"
```

Check the connection, then follow the trace in a second terminal:

```sh
claude mcp list
tail -f /tmp/poc-trace.log
```

Paste this prompt into Claude Code:

```text
Use the create_project tool from the poc-elicit MCP server to create a project
named cc-ui-capture in organization org_demo. Call the tool exactly once and
show me the raw result.
```

Add a compute size to get the hourly variant of the prompt:

```text
Use the create_project tool from the poc-elicit MCP server to create a project
named barrys-analytics in organization supabase-mcp-ltd with compute size Micro.
Call the tool exactly once and show me the raw result.
```

Claude Code exposes the tool as `mcp__poc-elicit__create_project`. The prompt
carries the whole cost breakdown in its `message`, which is the only formatting
the server controls, and `requestedSchema` declares no properties. So the client
shows the message with its accept and decline controls and no field to fill in,
and consent arrives as `action`. Newlines in the message survive the wire.

A completed 2025-era round reads:

```text
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2025-11-25 elicitation=form sub=anonymous path=classic
[poc form] -> elicitation/create mode=form
[poc form] <- elicitation result action=accept
[poc form] accepted key=confirm_cost via=action
[poc form] created project id=<uuid> name=cc-ui-capture
```

On the 2026-07-28 era the same round runs as two tool calls:

```text
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] -> input_required key=confirm_cost mode=form reason=no-state
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] accepted key=confirm_cost via=action
```

`path=legacy` in that first line means the client declared no elicitation
capability and no UI will appear. Project creation stays mock unless the
Management API variables are set, so a capture writes to the in-memory registry
only. If the call times out while the prompt waits for an answer, raise
`MCP_TOOL_TIMEOUT` for the Claude Code process; the server already allows 600s
for the pushed 2025-era request.

Remove the server when the capture is done:

```sh
claude mcp remove poc-elicit
```
