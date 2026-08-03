# Risk 6: Inspector 2.0 web UI vs URL-mode elicitation

Date tested: 2026-08-03. Method: headless Chromium driving Inspector 2.0.0's web UI
(`npx @modelcontextprotocol/inspector`, page at `localhost:6274`) against the PoC's
url-mode MCP endpoint (`http://localhost:3902/mcp`), connect page on `:3901`.
Recorded by the orchestrator (not a worker: workers have no browser).

## Verdict

Inspector 2.0's web UI **does support URL-mode elicitation on 2026-07-28**, and its
implementation matches the spec's client MUSTs/SHOULDs that we care about.

## Verified by direct observation

1. **Connects modern.** Server added as `streamable-http`, per-server Protocol Era set
   to "Modern (2026-07-28, sessionless)"; the card then reported `MCP 2026-07-28`.
   (Default is Legacy — same gotcha as form mode.)
2. **URL-mode capability is declared.** Our handler only emits a url elicitation to a
   client declaring `elicitation.url`; Inspector received one, so it declares it.
   (Its CLI does not — see `NOTES.risk5.md`.)
3. **The modal renders correctly.** `dialog "Elicitation Request"` containing:
   - our exact message: *Open this page to enter your API key for "openai-key". It is
     stored by Supabase and never passes through your MCP client.*
   - an `input_required` tag plus the explanation "your answer is sent back as a retry
     of the original request (MRTR)"
   - **the full URL displayed as text**, not a bare link:
     `http://localhost:3901/connect?i=439fb04b-b4a2-4a56-a6ed-b99dfe7f598d`
     (spec MUST: show the full URL for examination)
   - `Copy URL` and `Open in Browser` buttons — **no auto-navigation, no prefetch**
     (spec MUSTs: explicit consent, no automatic open)
   - a warning: "This will open an external URL. Verify the domain before proceeding."
   - `Cancel`
   - a `Request ID: elicitation-<uuid>` line (Inspector synthesizes an id for display)
4. **No premature accept.** Before consent the MRTR conversation in the monitoring
   sidebar stayed at **1 round / "Awaiting input"** — Inspector does not send
   `{action:'accept'}` until the user acts.
5. **After clicking "Open in Browser"**: the button relabels to `Reopen in Browser`, the
   modal adds **"Waiting for completion..."**, and a new button appears:
   **"I've completed it"**. So Inspector does NOT poll or auto-advance; it implements
   exactly the spec's "clients SHOULD provide manual controls that let the user retry or
   cancel" — the retry fires when the user asserts the out-of-band work is done.
6. **The out-of-band leg works against the mock connect page** (driven in a second tab):
   - no session cookie → "A valid mock dashboard session is required." (the URL alone
     grants nothing; spec MUST: not pre-authenticated)
   - with the matching session cookie → the key form renders
   - submitting → "Your API key is stored. You can return to your client."
   The secret was typed only into the connect page, never into any MCP field.

## NOT verified (honest gap)

The **final click of "I've completed it" through the UI** was not observed to close the
round. My first click timed out at the automation layer (8s) and a retry hung the cell;
afterwards the Inspector client showed "Tool Call Failed / Not connected". The PoC
server process stayed healthy throughout (its log shows no error and it kept serving),
so this looks like automation/transport flakiness in the headless session rather than an
Inspector or server defect — but I did not reproduce it cleanly, so treat
"accept-after-completion completes the round **in Inspector**" as unverified.

The equivalent server-side path IS covered programmatically: the url happy-path and
lifecycle suites drive accept-while-pending → re-issue → connect-page completion →
accept → `{ status: 'stored' }`.

By elapsed time the captured `requestState` (exp `1785757210`, ttl 300s) had expired, so
a replay probe to determine whether that click had in fact reached the server would have
returned "expired" and been inconclusive. Not attempted.

## Practical notes for the team's demo plan

- Set Protocol Era to **Modern** per server, or you silently test the 2025 path.
- URL mode needs the **web UI**; the CLI declares no elicitation capability at all.
- The demo has two windows by nature: the client (modal) and the browser (connect page).
  Inspector's "I've completed it" is the hand-off point between them.
