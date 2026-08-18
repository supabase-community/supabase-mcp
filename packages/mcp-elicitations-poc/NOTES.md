# SDK findings

- The installed `@modelcontextprotocol/server@2.0.0` exports
  `inputRequired`, `acceptedContent`, `inputResponse`,
  `createRequestStateCodec`, and `createMcpHandler` with the documented names.
  The schema-aware `acceptedContent(responses, key, schema)` overload returns
  validated typed content or `undefined`.
- `createRequestStateCodec({ key, ttlSeconds, bind })` requires a key of at
  least 32 bytes. `mint(payload, ctx?)` is async, and `verify(state, ctx)` is
  assigned to `ServerOptions.requestState.verify`.
- The codec adds its own `exp` envelope field from `ttlSeconds`; the PoC payload
  therefore includes `iat` but not a duplicate `exp`.
- The codec is HMAC-SHA256 signed, not encrypted. Its `v1.<body>.<mac>` body is
  client-readable base64url JSON.
- `bind` receives `ServerContext` at mint and verify time. It binds an arbitrary
  context-derived string by storing a truncated, domain-separated HMAC tag.
  The PoC binds the originating MCP method and separately checks the principal
  and argument digest in the required handler order.
- HTTP headers are available as `ctx.http.req.headers` in a tool handler.
  `createMcpHandler` also passes the original request to the factory as
  `requestInfo`. This PoC mock-decodes `Authorization: Bearer <token>` by using
  the raw token as `sub`; no header means `anonymous`.
- A codec verification rejection is handled above the tool callback as JSON-RPC
  `-32602` (`Invalid or expired requestState`). Principal, argument, and replay
  policy rejections happen inside the tool callback and return tool results
  with `isError: true`.
- The exact intermediate wire discriminator observed in the happy-path test is
  `input_required`. The public `client.callTool()` result omits `resultType`, so
  the harness captures raw HTTP response frames.
- The client option is `capabilities`, with
  `{ elicitation: { form: {} } }`; the SDK writes this under
  `_meta["io.modelcontextprotocol/clientCapabilities"]`. Auto-fulfilment is on
  by default, uses `client.setRequestHandler("elicitation/create", handler)`,
  and echoes `requestState` while retrying with a fresh JSON-RPC id.
- The SDK's typed `ElicitResult.content` index is narrower than the harness
  contract: it accepts only primitive form values (`string`, `number`,
  `boolean`, or `string[]`), while the requested harness callback exposes
  `Record<string, unknown>`. The harness casts only at that adapter boundary;
  the server validates accepted content with Zod.
- `createMcpHandler` returns the documented web-standard
  `{ fetch, close, notify, bus }`. `@modelcontextprotocol/node` exports
  `toNodeHandler` for the runnable `node:http` entry.
- The request-state key comes from `POC_STATE_KEY` or is generated once per
  process. A repo literal was unacceptable because it let clients mint valid
  request states without possessing a deployed server's key.
