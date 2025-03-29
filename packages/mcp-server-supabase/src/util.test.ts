import { describe, expect, it } from 'vitest';
import { parseKeyValueList } from './util.js';

describe('parseKeyValueList', () => {
  it('should parse a simple key-value string', () => {
    const input = 'key1=value1\nkey2=value2';
    const result = parseKeyValueList(input);
    expect(result).toEqual({ key1: 'value1', key2: 'value2' });
  });

  it('should handle empty values', () => {
    const input = 'key1=\nkey2=value2';
    const result = parseKeyValueList(input);
    expect(result).toEqual({ key1: '', key2: 'value2' });
  });

  it('should handle values with equals sign', () => {
    const input = 'key1=value=with=equals\nkey2=simple';
    const result = parseKeyValueList(input);
    expect(result).toEqual({ key1: 'value=with=equals', key2: 'simple' });
  });

  it('should handle empty input', () => {
    const input = '';
    const result = parseKeyValueList(input);
    expect(result).toEqual({});
  });

  it('should handle input with only newlines', () => {
    const input = '\n\n\n';
    const result = parseKeyValueList(input);
    expect(result).toEqual({});
  });

  it('should parse real-world Cloudflare trace output', () => {
    const input =
      'fl=123abc\nvisit_scheme=https\nloc=US\ntls=TLSv1.3\nhttp=http/2';
    const result = parseKeyValueList(input);
    expect(result).toEqual({
      fl: '123abc',
      visit_scheme: 'https',
      loc: 'US',
      tls: 'TLSv1.3',
      http: 'http/2',
    });
  });
});
