# Risk 6: URL-mode elicitation

## SDK observations

- The installed server package exports `inputRequired.elicitUrl(params)`. Its
  type accepts `Omit<ElicitRequestURLParams, "mode" | "elicitationId">`.
  The caller supplies `message` and `url`. The builder adds `mode: "url"` and
  an elicitation ID. This matches the assumed helper, with the added generated
  ID detail.
- The client emits URL support as `elicitation: { url: {} }` in the per-request
  client capability metadata. Form support uses `elicitation: { form: {} }`.
- The automatic multi round-trip driver dispatches a URL input request through
  the registered `elicitation/create` handler. It accepts an action-only result.
  The happy-path test uses raw calls because the test must inspect the first
  accepted retry before the connect page completes.
- The SDK validates URL elicitation requests and results. It does not enforce
  this tool's per-request URL capability rule before the handler returns an
  `input_required` result. The tool handler checks `elicitation.url` first and
  returns `unsupported_client` for form-only or absent support.
- A retry that accepts before the browser flow completes returns
  `resultType: "input_required"`. It carries fresh request state and the same
  opaque interaction ID.

## Security and state

The URL contains only an opaque interaction ID. A request without the mock
dashboard session gets HTTP 401. A session for another principal gets HTTP 403,
and the interaction stays pending.

The connect app stores the secret by principal and name. The MCP result returns
only a reference and the final four characters.

MRTR can keep the transport stateless. A server can decide completion from
echoed signed request state. This PoC needs application storage for the
credential and for pending-flow correlation. A production deployment needs
durable shared storage for those records.
