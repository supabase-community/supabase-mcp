# Claude Code 2.1.226 against the PoC

Claude Code 2.1.226 connects to the PoC as a 2025-era client. The HTTP legacy path
loses its `initialize` capabilities before `create_project` runs. STDIO keeps them
and reaches the classic elicitation path.

Date tested: 2026-08-21

## Wire evidence

Against `http://localhost:3900/mcp`, Claude Code sent classic `initialize`:

```json
{
  "protocolVersion": "2025-11-25",
  "capabilities": {
    "roots": { "listChanged": true },
    "elicitation": {}
  }
}
```

Classic elicitation is declared. MRTR form mode under
`_meta["io.modelcontextprotocol/clientCapabilities"]` is absent.

`claude mcp list` reported `Connected`. No `server/discover` probe reached this
server, so the modern era was never negotiated here.

## Why HTTP form mode cannot serve it

`createMcpHandler` from `@modelcontextprotocol/server` 2.0.0 serves 2025-era traffic
with `legacy: 'stateless'` by default. Each legacy request gets a fresh server
instance over a transport built with `sessionIdGenerator: undefined`.

The `initialize` capabilities are gone when `create_project` runs, so a 2025-era
client reaches the legacy path in [`src/server.ts`](src/server.ts). A classic-era
probe client over HTTP received:

```json
{ "status": "confirmation_required", "confirm_cost_token": "<token>" }
```

## What STDIO gives

[`src/stdio.ts`](src/stdio.ts) uses `serveStdio(factory)`. One server instance stays
pinned to the connection, so `server.server.getClientCapabilities()` returns what the
client declared at `initialize`. The classic path in
[`src/server.ts`](src/server.ts) then calls `ctx.mcpReq.elicitInput` with the same
`$10/month` message and `confirm` boolean schema the MRTR path uses.

Verified with a newline-delimited JSON-RPC probe shaped like Claude Code
(`protocolVersion 2025-11-25`, `capabilities {"roots":{"listChanged":true},"elicitation":{}}`):

```text
[poc form] tools/call create_project client=claude-code-shaped-probe@2.1.226 protocol=2025-11-25 elicitation=form sub=anonymous path=classic
[poc form] -> elicitation/create mode=form
[poc form] <- elicitation result action=accept
[poc form] created project id=8a21ef4b-ba8e-4816-aa80-993c1f958c4c name=cc-stdio-demo
```

The pushed request:

```json
{
  "mode": "form",
  "message": "Creating project \"cc-stdio-demo\" costs $10/month. Do you confirm?",
  "requestedSchema": {
    "type": "object",
    "properties": {
      "confirm": {
        "type": "boolean",
        "description": "Confirm the recurring project cost."
      }
    },
    "required": ["confirm"]
  }
}
```

The client answered `{"action":"accept","content":{"confirm":true}}` and the tool
returned `status: created` with the `$10` monthly cost.
[`test/classic-elicitation.test.ts`](test/classic-elicitation.test.ts) asserts the
same round over an in-memory transport, plus decline, cancel, and an accept whose
content withholds confirmation.

## Claude Code UI, observed

A manual Claude Code session on 2026-08-21 completed three rounds against the STDIO
entry. Trace, verbatim:

```text
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2025-11-25 elicitation=form sub=anonymous path=classic
[poc form] -> elicitation/create mode=form
[poc form] <- elicitation result action=decline
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2025-11-25 elicitation=form sub=anonymous path=classic
[poc form] -> elicitation/create mode=form
[poc form] <- elicitation result action=accept
[poc form] created project id=569e5ddf-454f-4940-95f3-d4831fb77675 name=cc-ui-capture
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2025-11-25 elicitation=form sub=anonymous path=classic
[poc form] -> elicitation/create mode=form
[poc form] <- elicitation result action=decline
```

The prompt renders inline in the transcript, not as an overlay. It carries a heading
(`MCP server "poc-elicit" requests your input`), the server's `message`, one field
row per schema property (`confirm:` with a checkbox glyph), the property
`description` underneath, and `Accept` / `Decline` actions. Space toggles the
checkbox.

Pressing `Accept` with the checkbox unticked fails client-side validation: the field
row turns red and shows `This field is required`. Nothing reaches the server, and
the trace stays silent until the round completes.

The field's state, not the era, decides what `Accept` can send. An untouched checkbox
has no value and blocks submission. Ticking it and unticking it again leaves an
explicit `false`, which `Accept` submits: on the 2026-07-28 era that sequence
produced `accept` with `confirm: false` and the server declined the creation. So the
accept-with-`confirm: false` branch in [`src/server.ts`](src/server.ts) is live, and a
server must read refusal from both `action` and the content it validates. Treating
`accept` as consent is wrong. The same sequence was not tried on the 2025 era.

### Why the PoC now asks a question instead

Everything above was captured while `requestedSchema` declared `confirm` as a
required boolean. A cost confirmation is a yes or no, and a client that makes the
user set a field and then press `Accept` asks for the same answer twice.

[`src/server.ts`](src/server.ts) now sends `{"type":"object","properties":{}}` and
takes consent from `action`, which drops the field row and the client-side validation
with it. The message carries the whole breakdown, since it is the only formatting the
server controls:

```text
Creating this project costs $0.01344/hr while it runs.

Project          barrys-analytics
Organization     supabase-mcp-ltd
Compute size     Micro
Hourly rate      $0.01344/hr
30-day estimate  ~$9.68 if left running

Assumes continuous running. Cost recurs until deletion.
```

Newlines survive the wire, and the SDK accepts a property-less schema on both eras.
`compute_size` is an optional tool argument; without it the prompt shows the flat
`$10/month` block. How Claude Code lays the block out on screen is unverified.

## The 2026-07-28 era

`MCP_SDK_GENERATION=v2 MCP_PROTOCOL_NEGOTIATION=auto claude` puts Claude Code on the
v2 client. It negotiates `2026-07-28` and declares a mode-less `elicitation`:

```text
[poc form] server/discover client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty capabilities={"roots":{"listChanged":true},"elicitation":{}}
```

A manual session then completed the MRTR round twice, first refusing and then
confirming:

```text
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] -> input_required key=confirm_cost mode=form reason=no-state
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] -> declined key=confirm_cost confirm=false
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] -> input_required key=confirm_cost mode=form reason=no-state
[poc form] tools/call create_project client=claude-code@2.1.226 protocol=2026-07-28 elicitation=declared-empty lane=form sub=anonymous path=form
[poc form] accepted key=confirm_cost confirm=true
[poc form] created project id=bca18898-55a6-403d-b7f5-b0d0e7a92d26 name=cc-ui-capture
```

Each `tools/call` carries `clientInfo` and the capability object in its `_meta`, so
the per-request envelope is populated. The one server-side change that unlocked this
was reading a mode-less declaration as form capable: gating on `elicitation.form`
sent Claude Code to the `confirm_cost_token` path while it was capable of the UI.
The SDK agrees with that reading, since it emitted the request for a client whose
envelope declares `elicitation: {}`.

The first round refused by ticking `confirm`, unticking it, then pressing `Accept`.
That reached the server as `accept` with `confirm: false`, which the tool treats as a
decline. `action: decline` was not exercised on this era.

### The envelope gate, and one unexplained session

A request whose envelope omits `io.modelcontextprotocol/clientCapabilities` entirely
is rejected by the SDK before any tool runs:

```text
-32602 Invalid _meta envelope for protocol revision 2026-07-28: io.modelcontextprotocol/clientCapabilities: missing
```

A request that carries the key with no `elicitation` inside passes validation, and
then the emit is refused:

```text
-32021 Cannot request input 'confirm_cost' (elicitation/create): the request's client
capabilities do not declare the required capability
data: {"requiredCapabilities":{"elicitation":{"form":{}}}}
```

An earlier v2 session showed exactly that shape from Claude Code itself, three tool
calls reading `client=unknown@unknown protocol=2026-07-28 elicitation=absent
path=legacy`. The later session carries the full envelope, and nothing explains the
difference yet. `restoreDeclaredElicitation` in [`src/stdio.ts`](src/stdio.ts) covers
it: when a request arrives with a capability object that declares no elicitation, the
transport copies the opening declaration into the envelope. It did not fire during the
successful session, which is visible in the trace above by the absence of its line.

## SDK observations

- `getClientCapabilities()` reports a classic `elicitation: {}` declaration as form
  mode. The trace printed `elicitation=form` for a client that sent `elicitation: {}`
  on the wire.
- `ctx.mcpReq.elicitInput(params, options?)` sends the 2025-era push-style
  `elicitation/create` request. The SDK marks it deprecated, documents that it works
  on the legacy path, and documents that it throws on a 2026-07-28-era request.
- `serveStdio(factory)` takes the same factory shape as `createMcpHandler`, which is
  why [`src/server.ts`](src/server.ts) exposes `createPocServerFactory`.
- STDIO puts the protocol on stdout, so [`src/trace.ts`](src/trace.ts) writes to
  stderr and appends to `POC_TRACE_FILE` when that variable is set.

## Open

- Unverified: whether Claude Code's v2 client renders an `input_required` result. The
  envelope shim makes the server emit one; only a manual run shows what the client
  does with it.
- Unverified: Claude Code's MCP tool timeout while an elicitation waits. The observed
  session ran with `MCP_TOOL_TIMEOUT=600000` and never timed out, so the default was
  not measured.
- Unverified: how Claude Code renders a non-boolean field, a multi-property schema,
  or an enum. Only the single required boolean was exercised.
- Unverified: URL-mode elicitation in Claude Code. It declares `elicitation.url`, and
  the PoC serves that mode over HTTP only, which a 2025-era client cannot reach.
