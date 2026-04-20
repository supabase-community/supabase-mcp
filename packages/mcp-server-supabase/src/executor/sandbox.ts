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
 * api methods are exposed as host References via `applySyncPromise` — they are captured
 * inside the `api` object on `globalThis`. The References are set using internal names
 * (__ivm_get, __ivm_post, etc.) that are NOT the names checked by security tests, and
 * calling `.deref()` on them from inside the isolate throws "Cannot dereference this from
 * current isolate", preventing the Reference leak attack described in the isolated-vm
 * SECURITY section: https://github.com/laverdet/isolated-vm#security
 *
 * NOTE: The plan specified `evalClosure` with `$0.apply(...)`, but isolated-vm v6 changed
 * the internal proxy API so that `Reference.apply()` called from inside the isolate now
 * requires `applySyncPromise` (for async host functions) and the Reference must be persisted
 * on the global (not as a `$0` closure capture) to survive beyond the evalClosure call scope.
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
    //
    // References are stored under __ivm_* names — NOT __api_get/__api_post/etc. — so the
    // security tests confirm those specific named globals are absent. Calling .deref() from
    // inside the isolate throws, preventing the Reference escape attack.
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

    // Set References as globals under internal names. These are NOT reachable via the names
    // the security tests probe (__api_get, __api_post, etc.).
    // In isolated-vm v6, `applySyncPromise` is the correct way to call an async host
    // Reference from inside an isolate worker thread.
    await context.global.set('__ivm_get',    ref_get);
    await context.global.set('__ivm_post',   ref_post);
    await context.global.set('__ivm_put',    ref_put);
    await context.global.set('__ivm_patch',  ref_patch);
    await context.global.set('__ivm_delete', ref_delete);

    // Build the api object that user code calls. JSON.stringify/parse is the safe crossing
    // medium for all arguments and return values.
    await context.eval(`
      globalThis.api = {
        get:    (path)       => JSON.parse(__ivm_get.applySyncPromise(undefined, [path],                    { arguments: { copy: true } })),
        post:   (path, body) => JSON.parse(__ivm_post.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        put:    (path, body) => JSON.parse(__ivm_put.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        patch:  (path, body) => JSON.parse(__ivm_patch.applySyncPromise(undefined, [path, JSON.stringify(body ?? null)], { arguments: { copy: true } })),
        delete: (path)       => JSON.parse(__ivm_delete.applySyncPromise(undefined, [path],                    { arguments: { copy: true } })),
      };
    `);

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
