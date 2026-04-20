// src/executor/sandbox.ts
import ivm from 'isolated-vm';
import type { ApiClient } from './client.js';

const MEMORY_LIMIT_MB = 32;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Runs agent code with the OpenAPI spec injected as `spec`.
 * Code must use `return` to produce a value.
 * The spec is deep-copied into the isolate as JSON — host object is never mutated.
 */
export async function runSearchCode(
  code: string,
  spec: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  try {
    const context = await isolate.createContext();

    // Pass spec as a JSON string — the only safe way to copy complex objects across
    // isolate boundaries. Parsed inside the isolate into a frozen object.
    await context.global.set('__specJson', JSON.stringify(spec), { copy: true });
    await context.eval('const spec = Object.freeze(JSON.parse(__specJson))');

    const script = await isolate.compileScript(`
      (async () => {
        const __r = await (async () => { ${code} })();
        return JSON.stringify(__r ?? null);
      })()
    `);

    const resultJson = await script.run(context, {
      promise: true,
      timeout: timeoutMs,
    }) as string;

    return JSON.parse(resultJson);
  } finally {
    isolate.dispose();
  }
}

/**
 * Runs agent code with `api` and optional extra context injected as top-level variables.
 * Code must use `return` to produce a value.
 *
 * api methods are exposed as host References bound via `evalClosure` as `$0`–`$4`. They are
 * captured inside the `api` object on `globalThis` but are NEVER set as named globals on
 * `context.global`. This prevents the "Reference leak" springboard attack described in the
 * isolated-vm SECURITY section: https://github.com/laverdet/isolated-vm#security
 *
 * `applySyncPromise` is the v6-correct method for invoking async host functions synchronously
 * from inside the isolate worker thread.
 *
 * @example
 *   runExecuteCode('return api.get("/v1/organizations")', api)
 *   runExecuteCode('return api.get(`/v1/projects/${project_id}/...`)', api, { project_id: 'abc' })
 */
export async function runExecuteCode(
  code: string,
  api: ApiClient,
  extraContext: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  try {
    const context = await isolate.createContext();

    // Host References for each HTTP method.
    // Results are serialized as JSON strings — the only safe crossing medium.
    // Body args for write methods arrive pre-serialized; the host parses them before
    // forwarding to the actual api client.
    const ref_get    = new ivm.Reference(async (path: string) =>
      JSON.stringify(await api.get(path) ?? null));
    const ref_post   = new ivm.Reference(async (path: string, bodyStr: string) =>
      JSON.stringify(await api.post(path, JSON.parse(bodyStr)) ?? null));
    const ref_put    = new ivm.Reference(async (path: string, bodyStr: string) =>
      JSON.stringify(await api.put(path, JSON.parse(bodyStr)) ?? null));
    const ref_patch  = new ivm.Reference(async (path: string, bodyStr: string) =>
      JSON.stringify(await api.patch(path, JSON.parse(bodyStr)) ?? null));
    const ref_delete = new ivm.Reference(async (path: string) =>
      JSON.stringify(await api.delete(path) ?? null));

    // Build the api object using evalClosure. References are bound as $0–$4 — they are
    // auto-detected as TransferableHandle objects and transferred into the isolate as
    // ReferenceHandle instances. They are scoped only to this closure body and are never
    // set as named globals on context.global. After this call returns, $0–$4 are not
    // reachable from isolate code; only the api object methods hold them via closure.
    //
    // NOTE: Do NOT pass { arguments: { reference: true } } here. That option wraps the
    // ivm.Reference object itself in another Reference (double-wrapping), causing
    // $0.typeof to appear as "object" instead of "function" and all apply calls to fail
    // with "Reference is not a function". The correct pattern is no arguments option —
    // isolated-vm's default transfer logic unwraps TransferableHandle objects via
    // ClassHandle::Unwrap, producing a proper function Reference inside the isolate.
    await context.evalClosure(
      `globalThis.api = {
        get:    (path)       => JSON.parse($0.applySyncPromise(undefined, [path],                          { arguments: { copy: true } })),
        post:   (path, body) => JSON.parse($1.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        put:    (path, body) => JSON.parse($2.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        patch:  (path, body) => JSON.parse($3.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        delete: (path)       => JSON.parse($4.applySyncPromise(undefined, [path],                          { arguments: { copy: true } })),
      };`,
      [ref_get, ref_post, ref_put, ref_patch, ref_delete]
    );

    // Inject extra context (e.g. project_id) as top-level variables via JSON.
    if (Object.keys(extraContext).length > 0) {
      await context.global.set('__ctxJson', JSON.stringify(extraContext), { copy: true });
      const assignments = Object.keys(extraContext)
        .map((k) => `const ${k} = __ctx[${JSON.stringify(k)}];`)
        .join('\n');
      await context.eval(`const __ctx = JSON.parse(__ctxJson);\n${assignments}`);
    }

    const script = await isolate.compileScript(`
      (async () => {
        const __r = await (async () => { ${code} })();
        return JSON.stringify(__r ?? null);
      })()
    `);

    const resultJson = await script.run(context, {
      promise: true,
      timeout: timeoutMs,
    }) as string;

    return JSON.parse(resultJson);
  } finally {
    isolate.dispose();
  }
}
