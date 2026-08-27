/**
 * PROTOTYPE: Does a server-derived auth_grant_id remain useful when a modern
 * MCP client does not return Mcp-Session-Id?
 *
 * This models the identities the hosted auth middleware can already recover.
 * It checks credential provenance and interaction correlation separately;
 * neither is presented as a logical MCP session.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createInterface } from "node:readline/promises";

const SECRET = "prototype-only-auth-grant-key";

type Credential =
  | { type: "oauth" | "pat"; rowId: string }
  | { type: "jwt"; issuer: string; jti?: string; rawToken: string };

type Event = {
  label: string;
  client: string;
  authGrantId: string;
  interactionId: string;
};

type State = {
  oauthRowId: number;
  oauthTokenVersion: number;
  jwtTokenVersion: number;
  interactionNumber: number;
  events: Event[];
};

type Action =
  | "oauth-refresh"
  | "shared-grant-client"
  | "new-interaction"
  | "retry-interaction"
  | "jwt-reissue"
  | "new-oauth-grant";

function authGrantId(credential: Credential): string {
  const material =
    credential.type === "jwt"
      ? credential.jti
        ? `jwt:${credential.issuer}:${credential.jti}`
        : `jwt-token:${credential.issuer}:${credential.rawToken}`
      : `${credential.type}:${credential.rowId}`;

  return `ag_${createHmac("sha256", SECRET).update(material).digest("base64url").slice(0, 16)}`;
}

function oauthCredential(state: State): Credential {
  return { type: "oauth", rowId: String(state.oauthRowId) };
}

function jwtCredential(state: State): Credential {
  return {
    type: "jwt",
    issuer: "https://issuer.example",
    rawToken: `jwt-token-v${state.jwtTokenVersion}`,
  };
}

function record(
  state: State,
  label: string,
  client: string,
  credential: Credential,
  interactionId = `ix_${state.interactionNumber}`,
): State {
  return {
    ...state,
    events: [
      ...state.events,
      { label, client, authGrantId: authGrantId(credential), interactionId },
    ],
  };
}

function initialState(): State {
  const state: State = {
    oauthRowId: 42,
    oauthTokenVersion: 1,
    jwtTokenVersion: 1,
    interactionNumber: 1,
    events: [],
  };

  return record(
    record(state, "oauth-before-refresh", "client-a", oauthCredential(state)),
    "jwt-before-reissue",
    "client-jwt",
    jwtCredential(state),
    "ix_jwt",
  );
}

function reduce(state: State, action: Action): State {
  switch (action) {
    case "oauth-refresh": {
      const next = { ...state, oauthTokenVersion: state.oauthTokenVersion + 1 };
      return record(next, "oauth-after-refresh", "client-a", oauthCredential(next));
    }
    case "shared-grant-client":
      return record(state, "same-grant-client-b", "client-b", oauthCredential(state));
    case "new-interaction": {
      const next = { ...state, interactionNumber: state.interactionNumber + 1 };
      return record(next, "new-interaction", "client-a", oauthCredential(next));
    }
    case "retry-interaction":
      return record(state, "interaction-retry", "client-a", oauthCredential(state));
    case "jwt-reissue": {
      const next = { ...state, jwtTokenVersion: state.jwtTokenVersion + 1 };
      return record(next, "jwt-after-reissue", "client-jwt", jwtCredential(next), "ix_jwt");
    }
    case "new-oauth-grant": {
      const next = {
        ...state,
        oauthRowId: state.oauthRowId + 1,
        oauthTokenVersion: 1,
      };
      return record(next, "new-oauth-grant", "client-a", oauthCredential(next));
    }
  }
}

function event(state: State, label: string): Event {
  const found = state.events.find((item) => item.label === label);
  assert(found, `Missing event: ${label}`);
  return found;
}

function checks(state: State) {
  const oauthBefore = event(state, "oauth-before-refresh");
  const oauthAfter = state.events.find((item) => item.label === "oauth-after-refresh");
  const sharedClient = state.events.find((item) => item.label === "same-grant-client-b");
  const newInteraction = state.events.find((item) => item.label === "new-interaction");
  const retry = state.events.find((item) => item.label === "interaction-retry");
  const jwtBefore = event(state, "jwt-before-reissue");
  const jwtAfter = state.events.find((item) => item.label === "jwt-after-reissue");
  const newGrant = state.events.find((item) => item.label === "new-oauth-grant");

  return {
    oauthRefreshKeepsGrantId:
      oauthAfter && oauthBefore.authGrantId === oauthAfter.authGrantId,
    sharedGrantCannotDistinguishClients:
      sharedClient && oauthBefore.authGrantId === sharedClient.authGrantId,
    newInteractionKeepsGrantId:
      newInteraction && oauthBefore.authGrantId === newInteraction.authGrantId,
    retryKeepsInteractionId:
      newInteraction && retry && newInteraction.interactionId === retry.interactionId,
    jwtWithoutStableClaimSplitsOnReissue:
      jwtAfter && jwtBefore.authGrantId !== jwtAfter.authGrantId,
    newOauthGrantGetsNewId:
      newGrant && oauthBefore.authGrantId !== newGrant.authGrantId,
  };
}

const demoActions: Action[] = [
  "oauth-refresh",
  "shared-grant-client",
  "new-interaction",
  "retry-interaction",
  "jwt-reissue",
  "new-oauth-grant",
];

function runDemo() {
  const state = demoActions.reduce(reduce, initialState());
  const result = checks(state);
  assert.deepEqual(result, {
    oauthRefreshKeepsGrantId: true,
    sharedGrantCannotDistinguishClients: true,
    newInteractionKeepsGrantId: true,
    retryKeepsInteractionId: true,
    jwtWithoutStableClaimSplitsOnReissue: true,
    newOauthGrantGetsNewId: true,
  });

  console.log(
    JSON.stringify(
      {
        question:
          "Can auth_grant_id provide cross-request correlation without claiming a logical MCP session?",
        result,
        events: state.events,
        verdict:
          "Yes for credential provenance. OAuth refresh preserves it because the row ID stays stable; shared credentials merge clients, and JWTs without a stable grant claim split on reissue. interaction_id identifies one Continuation State.",
      },
      null,
      2,
    ),
  );
}

function render(state: State) {
  console.clear();
  console.log("\u001b[1mAuth grant correlation prototype\u001b[0m");
  console.log("\u001b[2mNo value below claims to be a logical MCP session.\u001b[0m\n");
  console.table(state.events);
  console.log("\n\u001b[1mChecks\u001b[0m");
  console.log(checks(state));
  console.log(
    "\n[o] OAuth refresh  [c] same grant, second client  [n] new interaction\n" +
      "[r] retry interaction  [j] JWT reissue  [g] new OAuth grant  [q] quit",
  );
}

async function runInteractive() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let state = initialState();
  const actions: Record<string, Action> = {
    o: "oauth-refresh",
    c: "shared-grant-client",
    n: "new-interaction",
    r: "retry-interaction",
    j: "jwt-reissue",
    g: "new-oauth-grant",
  };

  while (true) {
    render(state);
    const input = (await readline.question("> ")).trim().toLowerCase();
    if (input === "q") break;
    const action = actions[input];
    if (action) state = reduce(state, action);
  }

  readline.close();
}

if (process.argv.includes("--demo")) runDemo();
else await runInteractive();
