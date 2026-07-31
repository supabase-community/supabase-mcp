# Risk 5: MCP Inspector 2.0 CLI

Date tested: 2026-07-31

## Verdict

Inspector 2.0.0 can connect to this server over Streamable HTTP, list
`create_project` with its schema, and negotiate the modern `2026-07-28`
protocol revision when `protocolEra: "modern"` is set in server config.

The non-interactive CLI did **not** exercise the PoC's MRTR path. CLI mode
constructs its client with elicitation disabled, so it does not advertise
`capabilities.elicitation.form`. This server detects that and returns its
legacy `confirmation_required` result instead of an MRTR `input_required`
result. The CLI prints that result and exits successfully. It does not pause,
show a pending form, print a raw `InputRequiredResult`, or error.

There are no CLI help flags for advertising form elicitation or supplying an
MRTR form response. The legacy token can be copied into a second call, but
that proves only the PoC fallback, not MRTR.

Therefore:

- **2026-07-28 protocol, CLI:** yes, when explicitly configured for the modern
  era. An ad-hoc URL invocation defaults to the legacy era.
- **MRTR, non-interactive CLI against this capability-gated PoC:** not
  completable or directly observable.
- **Web UI:** the packaged README explicitly describes manual MRTR support:
  `inputRequired: { autoFulfill: false }`, an `input_required` pending-request
  modal, a user-supplied form response, and retry to completion. I did not
  launch a browser, so that UI behavior was not independently verified here.

## Version and endpoint

- Inspector: `@modelcontextprotocol/inspector@2.0.0`
- Inspector's packaged dependencies include
  `@modelcontextprotocol/{client,core,server}@2.0.0-beta.5`.
- Server endpoint, from `src/main.ts` and startup output:
  `http://localhost:3900/mcp`
- Node requirement printed in the package metadata: `>=22.19.0`

The initial `npx` attempt hit a root-owned default npm cache. All subsequent
Inspector commands used `npm_config_cache=/private/tmp/risk5-npm-cache`; no
repository dependency or user npm cache was changed.

## Commands and transcripts

### CLI help

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --help
```

Trimmed output:

```text
Usage: mcp-inspector [options]

MCP Inspector – run web UI, CLI, or TUI

Options:
  --web       Run web UI (default)
  --cli       Run CLI
  --tui       Run TUI
```

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli --help
```

Relevant output:

```text
Usage: inspector-cli [options] [target...]
  --method <method>
  --tool-name <toolName>
  --tool-arg <pairs...>
  --metadata <pairs...>
  --tool-metadata <pairs...>
  --format <format>
  --tool-args-json <json>
```

No elicitation, pending-request, MRTR-response, or protocol-era option is
exposed as a direct CLI flag. Protocol era is a per-server config field.

### Start server

```sh
pnpm --filter @supabase/mcp-elicitations-poc dev
```

Output:

```text
> @supabase/mcp-elicitations-poc@0.0.0 dev
> tsx src/main.ts

MCP Elicitations PoC listening on http://localhost:3900/mcp
```

The process was stopped with Ctrl-C after testing.

### List tools, ad-hoc URL

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
MCP_CATALOG_PATH=/private/tmp/risk5-mcp-catalog.json \
MCP_CLIENT_CONFIG_PATH=/private/tmp/risk5-client.json \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli \
  http://localhost:3900/mcp \
  --method tools/list --format json
```

Output, formatted and trimmed only to remove Node warnings:

```json
{
  "result": {
    "tools": [{
      "name": "create_project",
      "description": "Create a mock Supabase project.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "organization_id": { "type": "string" },
          "confirm_cost_token": { "type": "string" }
        },
        "required": ["name", "organization_id"],
        "$schema": "https://json-schema.org/draft/2020-12/schema"
      }
    }]
  }
}
```

### Call tool, ad-hoc URL

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
MCP_CATALOG_PATH=/private/tmp/risk5-mcp-catalog.json \
MCP_CLIENT_CONFIG_PATH=/private/tmp/risk5-client.json \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli \
  http://localhost:3900/mcp \
  --method tools/call \
  --tool-name create_project \
  --tool-args-json \
    '{"name":"risk5-cli-project","organization_id":"org_risk5"}' \
  --format json
```

Exact stdout, line-wrapped:

```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "Confirmation required. Retry with the supplied confirm_cost_token."
    }],
    "structuredContent": {
      "status": "confirmation_required",
      "confirm_cost_token": "bd0e0103516520447bb35122c84c7f3c60cc6c92fac637c0ea7b256c8dbf609b"
    }
  }
}
```

Exit code: `0`. It printed immediately and did not pause.

### Explicit modern-era call

The equivalent read-only Inspector config used for this run was:

```json
{
  "mcpServers": {
    "poc": {
      "url": "http://localhost:3900/mcp",
      "type": "streamable-http",
      "protocolEra": "modern"
    }
  }
}
```

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
MCP_CLIENT_CONFIG_PATH=/private/tmp/risk5-client.json \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli \
  --config packages/mcp-elicitations-poc/NOTES.risk5.md \
  --server poc \
  --method tools/call \
  --tool-name create_project \
  --tool-args-json \
    '{"name":"risk5-modern-project","organization_id":"org_risk5"}' \
  --format json
```

At execution time `NOTES.risk5.md` temporarily contained the JSON config
above; it was then replaced with these notes.

Exact stdout, line-wrapped:

```json
{
  "result": {
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "mcp-elicitations-poc",
        "version": "0.0.0"
      }
    },
    "content": [{
      "type": "text",
      "text": "Confirmation required. Retry with the supplied confirm_cost_token."
    }],
    "structuredContent": {
      "status": "confirmation_required",
      "confirm_cost_token": "b9ebb773d7960c9860aea2622e471c05a46d8c1b4dd6bf05418aaeb25d4181d0"
    }
  }
}
```

Exit code: `0`. Explicit modern negotiation did not change the result because
the CLI still did not advertise form elicitation.

### Legacy fallback completion

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
MCP_CLIENT_CONFIG_PATH=/private/tmp/risk5-client.json \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli \
  --config packages/mcp-elicitations-poc/NOTES.risk5.md \
  --server poc \
  --method tools/call \
  --tool-name create_project \
  --tool-args-json \
    '{"name":"risk5-modern-project","organization_id":"org_risk5","confirm_cost_token":"b9ebb773d7960c9860aea2622e471c05a46d8c1b4dd6bf05418aaeb25d4181d0"}' \
  --format json
```

Trimmed result:

```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "Created project \"risk5-modern-project\"."
    }],
    "structuredContent": {
      "status": "created",
      "project": {
        "name": "risk5-modern-project",
        "organization_id": "org_risk5",
        "cost": { "amount": 10, "recurrence": "monthly" }
      }
    }
  }
}
```

This was a second independent CLI invocation using the server's fallback
token. It was not an MRTR retry carrying `requestState` and `inputResponses`.

### Capability injection attempt and protocol evidence

I also checked whether generic `--metadata` could inject the required client
capability:

```sh
npm_config_cache=/private/tmp/risk5-npm-cache \
MCP_CLIENT_CONFIG_PATH=/private/tmp/risk5-client.json \
  npx --yes @modelcontextprotocol/inspector@2.0.0 --cli \
  --config packages/mcp-elicitations-poc/NOTES.risk5.md \
  --server poc \
  --method tools/call \
  --tool-name create_project \
  --tool-args-json \
    '{"name":"risk5-forced-capability","organization_id":"org_risk5"}' \
  --metadata \
    'io.modelcontextprotocol/clientCapabilities={"elicitation":{"form":{}}}' \
  --format json
```

Exact stdout:

```json
{
  "error": {
    "code": "error",
    "message": "Invalid _meta envelope for protocol revision 2026-07-28: io.modelcontextprotocol/clientCapabilities: Invalid input: expected object, received string"
  }
}
```

Exit code: `1`. This is direct evidence that the configured run negotiated
`2026-07-28`. It also shows that `--metadata key=value` treats the value as a
string, so it cannot be used as a hidden JSON-valued capability workaround.

## Where the CLI stops

For this PoC, the CLI stops after the first ordinary `tools/call` response.
The server sees no `elicitation.form` client capability and never emits
`resultType: "input_required"`. Consequently there is no MRTR request state,
embedded `confirm_cost` elicitation, pending prompt, or form-answer retry for
the CLI to process.

The team's manual testing story should use Inspector's web UI in Modern
protocol mode for the actual MRTR form flow. The CLI remains useful for
connectivity, schema discovery, protocol-era checks, and verifying the
non-capable-client fallback. Headless CI coverage of the real MRTR path needs
a capable programmatic client unless a later Inspector CLI adds capability
and response flags.

## Web UI verification (2026-07-31 follow-up, orchestrator-driven browser session)

The gap above ("web UI not independently verified") is now closed. A headless
Chromium session drove Inspector 2.0.0's web UI end to end against
`http://localhost:3900/mcp`:

1. Added the server manually (transport `streamable-http`), Server Settings →
   Protocol Era → "Modern (2026-07-28, sessionless)" (default is Legacy; the
   first connect negotiated `MCP 2025-11-25` until the era was switched and
   the server reconnected, after which the card showed `MCP 2026-07-28`).
2. Tools tab → `create_project` → name `inspector-demo`, organization_id
   `org-1` → Execute Tool.
3. The call paused ("Awaiting input"); the monitoring sidebar showed an
   "MRTR conversation" entry carrying the `v1.<payload>.<mac>` requestState.
4. A modal `dialog "Elicitation Request"` appeared with: the exact server
   message (`Creating project "inspector-demo" costs $10/month. Do you
   confirm?`), an `input_required` tag ("your answer is sent back as a retry
   of the original request (MRTR)"), the `confirm` checkbox (Submit disabled
   until checked — required-field enforcement from requestedSchema), a trust
   warning naming the requesting server, and Cancel / Decline / Submit.
5. Checking `confirm` and submitting completed the retry: Results panel
   showed `Created project "inspector-demo".` and the MRTR conversation
   settled at 2 rounds, completed.

Verdict update: Inspector 2.0.0 **web UI** fully supports the 2026-07-28
form-elicitation MRTR flow, verified against this PoC. The principal was
`anonymous` (no Authorization header configured in the UI session), so
principal binding was consistent across both legs.
