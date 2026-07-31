# Risk 4: capability-gating findings

1. A client that does not declare elicitation receives a normal
   `confirmation_required` tool result and a `confirm_cost_token`. Its captured
   responses contain neither `inputRequests` nor `input_required`. Retrying with
   the token creates exactly one project.
2. A declaring client receives one form elicitation. The message includes
   `$10/month`, and accepting it creates exactly one project. The intermediate
   wire result has one `inputRequests` entry, `confirm_cost`. That entry is an
   `elicitation/create` request whose params have mode `form` and a schema with
   a boolean `confirm` property.
3. The exact observed SDK wire discriminator is **`input_required`**. The public
   tool result hides it, so the test pins the value from the raw response frame.
4. A precomputed legacy token does not bypass elicitation for a capable client.
   The handler deliberately chooses the capability branch first and ignores the
   token there. The project does not exist when the responder runs, and is
   created only after acceptance. This makes “capable clients must elicit” the
   current policy answer, though the RFC should confirm it explicitly.
5. A non-declaring raw request cannot redeem valid state and accepted responses
   minted for a declaring request. It is not rejected: the handler ignores both
   fields and returns the normal legacy `confirmation_required` result with a
   token. No project is created. Cross-capability redemption should be called
   out as an RFC edge case.

The PoC handler enforces capability gating. It checks per-request
`_meta` client capabilities before calling `inputRequired`; the SDK does not
refuse first because no input-required result is produced for it to process.
