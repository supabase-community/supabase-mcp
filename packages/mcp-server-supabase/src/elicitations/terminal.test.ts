import { describe, expect, test } from 'vitest';
import { z } from 'zod/v4';

import {
  recoveryResult,
  terminalResult,
  withTerminalOutput,
} from './terminal.js';

const businessSchema = z.object({
  id: z.string(),
  status: z.literal('created'),
});

const overlappingBusinessSchema = z.object({
  id: z.string(),
  status: z.enum(['created', 'declined', 'cancelled']),
});

describe('elicitation output widening', () => {
  test('keeps business output and adds the two terminal variants', () => {
    const outputSchema = withTerminalOutput(businessSchema);

    expect(
      outputSchema.parse({ id: 'project-1', status: 'created' })
    ).toStrictEqual({ id: 'project-1', status: 'created' });
    expect(outputSchema.parse({ status: 'declined' })).toStrictEqual({
      status: 'declined',
    });
    expect(outputSchema.parse({ status: 'cancelled' })).toStrictEqual({
      status: 'cancelled',
    });
  });

  test.each(['declined', 'cancelled'] as const)(
    'keeps complete business output whose status is %s',
    (status) => {
      const outputSchema = withTerminalOutput(overlappingBusinessSchema);

      expect(outputSchema.parse({ id: 'project-1', status })).toStrictEqual({
        id: 'project-1',
        status,
      });
      expect(outputSchema.parse({ status })).toStrictEqual({ status });
    }
  );

  test('advertises an object root MCP structured output accepts', () => {
    const jsonSchema = z.toJSONSchema(withTerminalOutput(businessSchema), {
      target: 'draft-7',
    });

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema).not.toHaveProperty('anyOf');
    expect(jsonSchema).not.toHaveProperty('oneOf');
  });

  test('rejects a terminal status the schema does not advertise', () => {
    const outputSchema = withTerminalOutput(businessSchema);

    expect(() => outputSchema.parse({ status: 'expired' })).toThrow();
  });

  test('keeps the variants distinct instead of accepting a blend', () => {
    const outputSchema = withTerminalOutput(businessSchema);

    // A terminal outcome ran no business logic, so it carries no business
    // field, and an accepted execution still owes every one of them.
    expect(() =>
      outputSchema.parse({ id: 'project-1', status: 'declined' })
    ).toThrow();
    expect(() => outputSchema.parse({ status: 'created' })).toThrow();
  });

  test('keeps the business schema unknown-key handling', () => {
    const loose = z.object({ id: z.string() }).catchall(z.unknown());
    const outputSchema = withTerminalOutput(loose);

    // Stripping here would turn output the tool is allowed to emit into a
    // validation failure on the call path.
    expect(outputSchema.parse({ id: 'project-1', extra: 1 })).toStrictEqual({
      id: 'project-1',
      extra: 1,
    });
  });
});

describe('terminal results', () => {
  test('keep decline and cancel distinct and carry caller copy verbatim', () => {
    const declined = terminalResult('declined', 'The user declined.');
    const cancelled = terminalResult('cancelled', 'The user cancelled.');

    expect(declined).toStrictEqual({
      content: [{ type: 'text', text: 'The user declined.' }],
      structuredContent: { status: 'declined' },
    });
    expect(cancelled).toStrictEqual({
      content: [{ type: 'text', text: 'The user cancelled.' }],
      structuredContent: { status: 'cancelled' },
    });
  });

  test('validate against the advertised schema', () => {
    const outputSchema = withTerminalOutput(businessSchema);

    expect(
      outputSchema.parse(terminalResult('declined', 'x').structuredContent)
    ).toStrictEqual({ status: 'declined' });
    expect(
      outputSchema.parse(terminalResult('cancelled', 'x').structuredContent)
    ).toStrictEqual({ status: 'cancelled' });
  });
});

describe('recovery results', () => {
  test('carry actionable text and no off-schema structured content', () => {
    const result = recoveryResult('This expired. Run the tool again.');

    expect(result).toStrictEqual({
      isError: true,
      content: [{ type: 'text', text: 'This expired. Run the tool again.' }],
    });
    expect('structuredContent' in result).toBe(false);
  });
});
