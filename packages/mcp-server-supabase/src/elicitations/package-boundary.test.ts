import { describe, expect, test } from 'vitest';

import * as packageEntry from '../index.js';
import * as apiPlatformEntry from '../platform/api-platform.js';
import * as platformEntry from '../platform/index.js';
import * as capability from './capability.js';
import * as codec from './codec.js';
import * as interactionId from './interaction-id.js';
import * as runtime from './runtime.js';
import * as state from './state.js';
import * as terminal from './terminal.js';

/**
 * The elicitation runtime is a private security module. It ships only as part
 * of the approved stack and is reachable through package-internal imports
 * alone, so an integrator cannot build on it, pin it, or depend on its shape.
 *
 * `policy.ts` carries types only and contributes no runtime value.
 */
const privateModules = {
  capability,
  codec,
  'interaction-id': interactionId,
  runtime,
  state,
  terminal,
};

const supportedEntryPoints = {
  '.': packageEntry,
  './platform': platformEntry,
  './platform/api': apiPlatformEntry,
};

describe('package boundary', () => {
  test('no supported entry point re-exports a private runtime value', () => {
    const leaked: string[] = [];
    const privateValues = new Map<unknown, string>();

    for (const [module, exports] of Object.entries(privateModules)) {
      for (const [name, value] of Object.entries(exports)) {
        privateValues.set(value, `${module}.${name}`);
      }
    }

    for (const [entry, exports] of Object.entries(supportedEntryPoints)) {
      for (const [name, value] of Object.entries(exports)) {
        const source = privateValues.get(value);
        if (source !== undefined) {
          leaked.push(`${entry} exports ${name} from ${source}`);
        }
      }
    }

    expect(privateValues.size).toBeGreaterThan(0);
    expect(leaked).toStrictEqual([]);
  });

  test('the main entry point exposes exactly the published surface', () => {
    expect(Object.keys(packageEntry).sort()).toStrictEqual([
      'CURRENT_FEATURE_GROUPS',
      'createSupabaseMcpHandler',
      'createSupabaseMcpServer',
      'createToolSchemas',
      'supabaseMcpToolSchemas',
      'version',
    ]);
    expect(Object.keys(apiPlatformEntry).sort()).toStrictEqual([
      'createSupabaseApiPlatform',
    ]);
  });

  test('no entry point publishes a name from the private vocabulary', () => {
    const privateVocabulary =
      /elicit|continuation|interaction|codec|terminal|capabilit|requeststate/i;

    for (const [entry, exports] of Object.entries(supportedEntryPoints)) {
      expect({
        entry,
        names: Object.keys(exports).filter((name) =>
          privateVocabulary.test(name)
        ),
      }).toStrictEqual({ entry, names: [] });
    }
  });
});
