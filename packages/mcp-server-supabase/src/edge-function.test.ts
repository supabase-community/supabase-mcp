import { describe, expect, it } from 'vitest';
import { normalizeFilename } from './edge-function.js';

describe('normalizeFilename', () => {
  it('handles deno 1 paths', () => {
    const result = normalizeFilename({
      deploymentId:
        'xnzcmvwhvqonuunmwgdz_2b72daae-bbb3-437f-80cb-46f2df0463d1_2',
      filename:
        '/tmp/user_fn_xnzcmvwhvqonuunmwgdz_2b72daae-bbb3-437f-80cb-46f2df0463d1_2/source/index.ts',
    });
    expect(result).toBe('index.ts');
  });

  it('handles deno 2 paths', () => {
    const result = normalizeFilename({
      deploymentId:
        'xnzcmvwhvqonuunmwgdz_2b72daae-bbb3-437f-80cb-46f2df0463d1_2',
      filename: 'source/index.ts',
    });
    expect(result).toBe('index.ts');
  });

  it("doesn't interfere with nested directories", () => {
    const result = normalizeFilename({
      deploymentId:
        'xnzcmvwhvqonuunmwgdz_2b72daae-bbb3-437f-80cb-46f2df0463d1_2',
      filename: '/my/local/source/index.ts',
    });
    expect(result).toBe('/my/local/source/index.ts');
  });
});
