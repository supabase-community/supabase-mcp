import { describe, expect, it } from 'vitest';

import { createUrlPoc } from '../src/url-server.js';
import { InMemoryInteractionStore } from '../src/url-stores.js';
import {
  createUrlTestClient,
  openConnectPage,
  rawUrlToolCall,
  submitSecret,
} from './url-harness.js';

function request(result: any) {
  return result.body.result.inputRequests.provide_api_key.params;
}

function interactionId(result: any): string {
  return new URL(request(result).url).searchParams.get('i')!;
}

function accept(requestState: string) {
  return {
    requestState,
    inputResponses: { provide_api_key: { action: 'accept' } },
  };
}

async function start(poc: ReturnType<typeof createUrlPoc>) {
  return rawUrlToolCall({ poc, args: { name: 'github' } });
}

async function retry(
  poc: ReturnType<typeof createUrlPoc>,
  requestState: string,
  inputResponses: Record<string, unknown> = {
    provide_api_key: { action: 'accept' },
  }
) {
  return rawUrlToolCall({
    poc,
    args: { name: 'github' },
    requestState,
    inputResponses,
  });
}

async function finish(
  poc: ReturnType<typeof createUrlPoc>,
  current: any,
  secret = 'sk-lifecycle-1234'
) {
  const id = interactionId(current);
  expect(
    (
      await submitSecret({
        poc,
        interactionId: id,
        secret,
        session: 'user-alice',
      })
    ).status
  ).toBe(200);
  return retry(poc, current.body.result.requestState);
}

describe('URL-mode lifecycle', () => {
  describe('accept before completion', () => {
    it('reissues fresh state for the same pending interaction', async () => {
      const poc = createUrlPoc();
      const first = await start(poc);
      const waiting = await retry(poc, first.body.result.requestState);

      expect(waiting.body.result.resultType).toBe('input_required');
      expect(waiting.body.result.requestState).not.toBe(
        first.body.result.requestState
      );
      expect(interactionId(waiting)).toBe(interactionId(first));
      expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
    });

    it('keeps one interaction through three accepted pending retries, then completes', async () => {
      const poc = createUrlPoc();
      const first = await start(poc);
      const id = interactionId(first);
      let current = first;

      for (let round = 0; round < 3; round += 1) {
        const previousState = current.body.result.requestState;
        current = await retry(poc, previousState);
        expect(current.body.result.resultType).toBe('input_required');
        expect(current.body.result.requestState).not.toBe(previousState);
        expect(interactionId(current)).toBe(id);
        expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
      }

      const complete = await finish(poc, current);
      expect(complete.body.result.structuredContent).toMatchObject({
        status: 'stored',
        name: 'github',
      });
      expect(poc.secrets.get('user-alice', 'github')?.last4).toBe('1234');
    });

    for (const [label, responses] of [
      ['a missing response entry', { unrelated: { action: 'accept' } }],
      ['an empty response map', {}],
    ] as const) {
      it(`reissues for ${label}`, async () => {
        const poc = createUrlPoc();
        const first = await start(poc);
        const waiting = await retry(
          poc,
          first.body.result.requestState,
          responses
        );

        expect(waiting.body.result.resultType).toBe('input_required');
        expect(waiting.body.result.requestState).not.toBe(
          first.body.result.requestState
        );
        expect(interactionId(waiting)).toBe(interactionId(first));
        expect(waiting.body.result.isError).not.toBe(true);
        expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
      });
    }
  });

  describe('expiry', () => {
    it('returns 404 when the connect page interaction has expired', async () => {
      let now = 1_000_000;
      const poc = createUrlPoc({ ttlSeconds: 1, clock: () => now });
      const first = await start(poc);
      now += 1_001;

      const page = await openConnectPage({
        poc,
        url: request(first).url,
        session: 'user-alice',
      });
      expect(page).toEqual({
        status: 404,
        body: 'Interaction not found or expired.',
      });
      expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
    });

    it('rejects an accepted retry after interaction expiry', async () => {
      let now = 2_000_000;
      const poc = createUrlPoc({ ttlSeconds: 1, clock: () => now });
      const first = await start(poc);
      now += 1_001;
      const expired = await retry(poc, first.body.result.requestState);

      expect(expired.body.result.isError).toBe(true);
      expect(expired.body.result.content[0].text).toBe(
        'The interaction is missing or expired.'
      );
      expect(expired.body.result.structuredContent).toEqual({
        status: 'error',
      });
      expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
    });

    it('can complete a fresh flow after an expiry rejection', async () => {
      let now = 3_000_000;
      const poc = createUrlPoc({ ttlSeconds: 1, clock: () => now });
      const expiredFlow = await start(poc);
      now += 1_001;
      expect(
        (await retry(poc, expiredFlow.body.result.requestState)).body.result
          .isError
      ).toBe(true);

      const fresh = await start(poc);
      const complete = await finish(poc, fresh, 'sk-fresh-5678');
      expect(complete.body.result.structuredContent).toMatchObject({
        status: 'stored',
      });
      expect(poc.secrets.get('user-alice', 'github')?.last4).toBe('5678');
    });
  });

  describe('one-time redemption', () => {
    it('rejects an identical completing retry without a second secret write', async () => {
      const poc = createUrlPoc();
      const first = await start(poc);
      const id = interactionId(first);
      expect(
        (
          await submitSecret({
            poc,
            interactionId: id,
            secret: 'sk-replay-9999',
            session: 'user-alice',
          })
        ).status
      ).toBe(200);
      const completing = accept(first.body.result.requestState);
      const complete = await rawUrlToolCall({
        poc,
        args: { name: 'github' },
        ...completing,
      });
      const stored = poc.secrets.get('user-alice', 'github');
      const replay = await rawUrlToolCall({
        poc,
        args: { name: 'github' },
        ...completing,
      });

      expect(complete.body.result.structuredContent.status).toBe('stored');
      expect(replay.body.result.isError).toBe(true);
      expect(JSON.stringify(replay.body)).toMatch(/replay|consumed/i);
      expect(poc.secrets.get('user-alice', 'github')).toEqual(stored);
      expect(stored?.ref).toBe(
        complete.body.result.structuredContent.secret_ref
      );
    });

    it('allows an interaction store record to be consumed once', () => {
      const interactions = new InMemoryInteractionStore(() => 100);
      interactions.create({
        id: 'one-time',
        principal: 'user-alice',
        tool: 'store_api_key',
        argsDigest: 'digest',
        exp: 200,
      });
      expect(interactions.complete('one-time')).toBe(true);
      expect(interactions.consume('one-time')).toBe(true);
      expect(interactions.consume('one-time')).toBe(false);
    });
  });

  describe('URL capability gating', () => {
    for (const capability of ['form-only', 'none'] as const) {
      it(`returns unsupported_client without a URL request for ${capability}`, async () => {
        const poc = createUrlPoc();
        const connection = await createUrlTestClient({
          poc,
          capabilities: capability,
        });
        try {
          const result: any = await connection.client.callTool({
            name: 'store_api_key',
            arguments: { name: 'github' },
          });
          expect(result.structuredContent).toEqual({
            status: 'unsupported_client',
            message:
              'A browser-capable client that declares URL elicitation is required.',
          });
          expect(JSON.stringify(connection.wire)).not.toMatch(
            /inputRequests|\"mode\":\"url\"/
          );
          expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
        } finally {
          await connection.close();
        }
      });
    }

    it('sends a URL request without a requested schema to a URL-capable client', async () => {
      const poc = createUrlPoc();
      const first = await start(poc);

      expect(request(first)).toMatchObject({
        mode: 'url',
        url: expect.any(String),
      });
      expect(request(first)).not.toHaveProperty('requestedSchema');
    });

    it('rejects valid URL state presented by a form-only client', async () => {
      const poc = createUrlPoc();
      const first = await start(poc);
      const crossCapability = await rawUrlToolCall({
        poc,
        capabilities: 'form-only',
        args: { name: 'github' },
        ...accept(first.body.result.requestState),
      });

      expect(crossCapability.body.result.isError).not.toBe(true);
      expect(crossCapability.body.result.structuredContent).toEqual({
        status: 'unsupported_client',
        message:
          'A browser-capable client that declares URL elicitation is required.',
      });
      expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
    });
  });
});
