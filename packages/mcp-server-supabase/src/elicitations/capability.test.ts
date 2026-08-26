import type { ToolRequestContext } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';

import { resolveElicitationAvailability } from './capability.js';

type Context = Pick<
  ToolRequestContext,
  'era' | 'clientInfo' | 'clientCapabilities'
>;

const modern = (
  clientCapabilities: ToolRequestContext['clientCapabilities']
): Context => ({
  era: 'modern',
  clientInfo: { name: 'test-client', version: '1.2.3' },
  clientCapabilities,
});

const servingPath = { formDeliveryAvailable: true };

describe('form elicitation availability', () => {
  test('accepts a mode-less declaration on a supported serving path', () => {
    expect(
      resolveElicitationAvailability(modern({ elicitation: {} }), servingPath)
    ).toStrictEqual({ formElicitation: true, reason: 'available' });
  });

  test('accepts an explicit form declaration on a supported serving path', () => {
    expect(
      resolveElicitationAvailability(
        modern({ elicitation: { form: {} } }),
        servingPath
      )
    ).toStrictEqual({ formElicitation: true, reason: 'available' });
  });

  test.each([
    ['null', null],
    ['array', []],
    ['string', 'form'],
    ['number', 1],
    ['boolean', true],
  ])('treats a malformed nested form %s as incapable', (_, form) => {
    const clientCapabilities = {
      elicitation: { form },
    } as unknown as ToolRequestContext['clientCapabilities'];

    expect(
      resolveElicitationAvailability(modern(clientCapabilities), servingPath)
    ).toStrictEqual({ formElicitation: false, reason: 'capability' });
  });

  test('treats URL-only and absent declarations as incapable', () => {
    expect(
      resolveElicitationAvailability(
        modern({ elicitation: { url: {} } }),
        servingPath
      )
    ).toStrictEqual({ formElicitation: false, reason: 'capability' });
    expect(
      resolveElicitationAvailability(modern({}), servingPath)
    ).toStrictEqual({ formElicitation: false, reason: 'capability' });
  });

  test.each([
    ['null', null],
    ['string', 'form'],
    ['number', 1],
    ['boolean', true],
    ['array', []],
  ])(
    'treats a malformed %s elicitation declaration as incapable',
    (_, elicitation) => {
      const clientCapabilities = {
        elicitation,
      } as unknown as ToolRequestContext['clientCapabilities'];

      expect(
        resolveElicitationAvailability(modern(clientCapabilities), servingPath)
      ).toStrictEqual({ formElicitation: false, reason: 'capability' });
    }
  );

  test('reports an unsupported serving path and an injected opt-out apart', () => {
    expect(
      resolveElicitationAvailability(modern({ elicitation: {} }), {
        formDeliveryAvailable: false,
      })
    ).toStrictEqual({ formElicitation: false, reason: 'serving_path' });
    expect(
      resolveElicitationAvailability(modern({ elicitation: {} }), {
        formDeliveryAvailable: true,
        optOut: true,
      })
    ).toStrictEqual({ formElicitation: false, reason: 'opt_out' });
  });

  test('keeps the classic era incapable even when it declares form support', () => {
    const classic: Context = {
      era: 'legacy',
      clientInfo: { name: 'test-client', version: '1.2.3' },
      clientCapabilities: { elicitation: { form: {} } },
    };

    expect(resolveElicitationAvailability(classic, servingPath)).toStrictEqual({
      formElicitation: false,
      reason: 'serving_path',
    });
  });

  test('gives client labels no authority over the outcome', () => {
    const clientCapabilities = { elicitation: { url: {} } };
    const labelled: Context = {
      era: 'modern',
      clientInfo: { name: 'claude-ai', version: '1.0.0' },
      clientCapabilities,
    };
    const otherLabel: Context = {
      era: 'modern',
      clientInfo: { name: 'some-other-client', version: '9.9.9' },
      clientCapabilities,
    };

    const known = resolveElicitationAvailability(labelled, servingPath);
    const unknown = resolveElicitationAvailability(otherLabel, servingPath);

    expect(known).toStrictEqual(unknown);
    expect(known).toStrictEqual({
      formElicitation: false,
      reason: 'capability',
    });
  });
});
