# Changelog

## [0.2.0](https://github.com/supabase/mcp/compare/mcp-server-postgrest-v0.1.1...mcp-server-postgrest-v0.2.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* the peer dependency is now `@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`, so consumers must install the new package. `@supabase/mcp-utils` also drops the exported types `ExtractRequest`, `ExtractNotification`, `ExtractResult` and `ExpandRecursively`, and `createMcpServer` returns a bare `Server` rather than `Server<Request, Notification, Result>`, because v2's `Server` class takes no type parameters. Because that returned value is now a v2 `Server`, a consumer who registered extra handlers on it must rewrite `server.setRequestHandler(SomeRequestSchema, ...)` as `server.setRequestHandler('some/method', ...)`; the v1 Zod-schema overload no longer exists. `InitData.clientCapabilities` now follows v2's `ClientCapabilities`, which is narrower than v1's and not assignable from it. Finally, a `tools/call` request whose `params` are malformed, meaning no `name` key or a non-string `name`, now returns JSON-RPC `-32602` with the message prefix `Invalid tools/call request: ` where v1 returned `-32603` with a bare stringified ZodError.

### Features

* migrate published packages to MCP SDK v2 ([#327](https://github.com/supabase/mcp/issues/327)) ([ead56f2](https://github.com/supabase/mcp/commit/ead56f228fcc316dd7d8db9030807fb7b3bfb73b))

## [0.1.1](https://github.com/supabase/mcp/compare/mcp-server-postgrest-v0.1.0...mcp-server-postgrest-v0.1.1) (2026-06-05)


### Bug Fixes

* update repo URLs after `supabase/mcp` transfer ([#295](https://github.com/supabase/mcp/issues/295)) ([71e48cc](https://github.com/supabase/mcp/commit/71e48cce0350e1b53191e8a0f9c6120314e4fcc1))
