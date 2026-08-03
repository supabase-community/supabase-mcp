# Risk 6: URL-mode security results

## Assertion outcomes

- **Secret isolation: pass after correction.** The original result returned `last4`, so four credential characters reached model context. The result now returns only an opaque `secret_ref`.
- **Wire scan: pass, and finite.** The test applies `JSON.stringify` to every captured request and response frame in both directions. It rejects all sentinel substrings of at least four characters, plus base64, base64url, and URI encodings of the full value and its last eight characters. Shorter plaintext fragments and encodings of arbitrary slices are outside the scan, so it is regression detection for the design choice (opaque ref only), not a proof of absence.
- **Opaque URL: pass.** The connect URL has one `i` query parameter. It contains no bearer, subject, or secret text.
- **Server-side storage: pass.** The secret store returns Alice's reference and last four characters after the browser submission.
- **Phishing binding: pass.** Bob and an unknown session cannot open or submit against Alice's interaction. Each rejection leaves the interaction pending and stores nothing.
- **Unauthenticated access: pass.** A request without a session cannot open the connect page. The interaction remains pending.
- **Recovery after rejection: pass.** Alice can use the same interaction after the rejected requests. Her accepted retry returns stored metadata.
- **Cross-principal redemption: pass.** Mallory cannot redeem Alice's signed request state. Mallory receives no secret reference or secret value. Alice's stored metadata remains unchanged.

## Rejection surfaces

- A missing session returns HTTP 401 with `A valid mock dashboard session is required.`
- A mismatched browser session returns HTTP 403 with `Session identity mismatch for this interaction.` This applies to GET and POST requests.
- A cross-principal MCP retry returns HTTP 200 with an MCP tool error. The text is `Request state principal mismatch.` The structured status is `error`.

## RFC design effect

The server must store the interaction ID, principal, tool, argument digest, expiry, and completion state. It must also store the secret by principal and name.

The real connect page needs the dashboard's authenticated session. The server must derive the principal from that session and compare it with the interaction record. The URL stays an opaque locator and grants no authority.

The RFC must decide whether any credential fingerprint belongs in a tool result. A fingerprint helps a user identify a stored key, but it remains credential material in model context, transcripts, and logs.
