import { describe, expect, it } from 'vitest';

import { createUrlPoc } from '../src/url-server.js';
import {
  openConnectPage,
  rawUrlToolCall,
  submitSecret,
} from './url-harness.js';

function elicitation(result: any) {
  return result.body.result.inputRequests.provide_api_key.params;
}

function interactionId(url: string): string {
  return new URL(url).searchParams.get('i')!;
}

describe('URL-mode elicitation happy path', () => {
  it('waits for the out-of-band interaction, then returns only secret metadata', async () => {
    const poc = createUrlPoc({
      stateKey: 'url-happy-path-state-key-at-least-32-bytes',
    });
    const first = await rawUrlToolCall({ poc, args: { name: 'github' } });
    const firstRequest = elicitation(first);
    expect(first.body.result.resultType).toBe('input_required');
    expect(firstRequest).toMatchObject({
      mode: 'url',
      url: expect.any(String),
    });
    expect(firstRequest).not.toHaveProperty('requestedSchema');
    const id = interactionId(firstRequest.url);

    const waiting = await rawUrlToolCall({
      poc,
      args: { name: 'github' },
      requestState: first.body.result.requestState,
      inputResponses: { provide_api_key: { action: 'accept' } },
    });
    expect(waiting.body.result.resultType).toBe('input_required');
    expect(waiting.body.result.requestState).not.toBe(
      first.body.result.requestState
    );
    expect(interactionId(elicitation(waiting).url)).toBe(id);

    expect((await openConnectPage({ poc, url: firstRequest.url })).status).toBe(
      401
    );
    expect(
      (
        await openConnectPage({
          poc,
          url: firstRequest.url,
          session: 'user-bob',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await openConnectPage({
          poc,
          url: firstRequest.url,
          session: 'user-alice',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await submitSecret({
          poc,
          interactionId: id,
          secret: 'sk-test-1234',
          session: 'user-alice',
        })
      ).status
    ).toBe(200);

    const complete = await rawUrlToolCall({
      poc,
      args: { name: 'github' },
      requestState: waiting.body.result.requestState,
      inputResponses: { provide_api_key: { action: 'accept' } },
    });
    expect(complete.body.result.structuredContent).toMatchObject({
      status: 'stored',
      name: 'github',
      secret_ref: expect.any(String),
    });
    expect(JSON.stringify(complete.body)).not.toContain('sk-test-1234');
    expect(poc.secrets.get('user-alice', 'github')).toEqual({
      ref: complete.body.result.structuredContent.secret_ref,
      last4: '1234',
    });
  });

  for (const action of ['decline', 'cancel'] as const) {
    it(`returns ${action} as a normal, distinct result`, async () => {
      const poc = createUrlPoc();
      const first = await rawUrlToolCall({ poc, args: { name: 'github' } });
      const final = await rawUrlToolCall({
        poc,
        args: { name: 'github' },
        requestState: first.body.result.requestState,
        inputResponses: { provide_api_key: { action } },
      });
      expect(final.body.result.structuredContent).toEqual({
        status: `${action}${action === 'cancel' ? 'led' : 'd'}`,
      });
      expect(final.body.result.isError).not.toBe(true);
      expect(poc.secrets.get('user-alice', 'github')).toBeUndefined();
    });
  }
});
