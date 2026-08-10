import { describe, expect, test } from 'vitest';
import { DAY_MS, resolveLogWindow } from './debugging-tools.js';

describe('resolveLogWindow', () => {
  test('defaults the end to now and the start to 24 hours before it', () => {
    const before = Date.now();
    const { iso_timestamp_start, iso_timestamp_end } = resolveLogWindow();
    const after = Date.now();

    const endMs = Date.parse(iso_timestamp_end);
    const startMs = Date.parse(iso_timestamp_start);

    expect(endMs).toBeGreaterThanOrEqual(before);
    expect(endMs).toBeLessThanOrEqual(after);
    expect(startMs).toBe(endMs - DAY_MS);
  });

  test('anchors the default start to a supplied end', () => {
    const end = '2024-02-01T11:00:00.000Z';
    const { iso_timestamp_start, iso_timestamp_end } = resolveLogWindow(
      undefined,
      end
    );

    expect(iso_timestamp_end).toBe(end);
    expect(iso_timestamp_start).toBe(
      new Date(Date.parse(end) - DAY_MS).toISOString()
    );
  });

  test('normalizes accepted timestamps to canonical UTC ISO strings', () => {
    const { iso_timestamp_start, iso_timestamp_end } = resolveLogWindow(
      '2024-02-01T09:00:00.000+01:00',
      '2024-02-01T11:00:00.000+01:00'
    );

    expect(iso_timestamp_start).toBe('2024-02-01T08:00:00.000Z');
    expect(iso_timestamp_end).toBe('2024-02-01T10:00:00.000Z');
  });

  test('rejects a malformed iso_timestamp_end', () => {
    expect(() => resolveLogWindow(undefined, 'not-a-timestamp')).toThrow(
      /Invalid iso_timestamp_end/
    );
  });

  test('rejects a malformed iso_timestamp_start', () => {
    expect(() =>
      resolveLogWindow('not-a-timestamp', '2024-02-01T11:00:00.000Z')
    ).toThrow(/Invalid iso_timestamp_start/);
  });

  test('rejects a start at or after the end', () => {
    expect(() =>
      resolveLogWindow('2024-02-01T11:00:00.000Z', '2024-02-01T10:00:00.000Z')
    ).toThrow(/must be before/);
  });

  test('rejects a window longer than 24 hours', () => {
    expect(() =>
      resolveLogWindow('2024-02-01T00:00:00.000Z', '2024-02-02T00:00:00.001Z')
    ).toThrow(/at most 24 hours/);
  });

  test('accepts a window exactly 24 hours long', () => {
    const start = '2024-02-01T00:00:00.000Z';
    const end = '2024-02-02T00:00:00.000Z';

    expect(() => resolveLogWindow(start, end)).not.toThrow();
  });
});
