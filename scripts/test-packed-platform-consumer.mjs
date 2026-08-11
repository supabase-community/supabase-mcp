// Proves that a Platform-shaped consumer can install the *published*
// @supabase/mcp-server-supabase package (plus its workspace dependency
// @supabase/mcp-utils) from real npm tarballs, on Platform's pinned zod
// version, entirely outside this pnpm workspace -- then exercises the
// package's public surface end to end.
//
// This is a packaging gate, not a unit test: it packs, installs with plain
// npm in a throwaway project outside the repo tree, and drives the packed
// artifact for real. Inspecting package.json/exports maps is explicitly not
// enough -- see AI-1044.
//
// Run with: pnpm test:packed-platform-consumer

import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Platform's pinned zod version. `supabase/platform`'s `develop` catalog pins
// zod to exactly this version today (checked 2026-08-11 at commit
// 603f39cb4c). The SDK only requires `zod: ^4.2.0`, so a Platform-shaped
// consumer must install cleanly on this pin. Bump this one constant -- and
// nothing else -- when Platform's catalog pin changes.
const PLATFORM_ZOD_VERSION = '4.4.3';
// ---------------------------------------------------------------------------

// The stable SDK release this repo is built against (see AI-1044). Pinned
// exactly, rather than left as a range, so this gate can't silently start
// exercising a newer SDK release than the one the package actually targets.
const SDK_VERSION = '2.0.0';

// TypeScript used to typecheck the packed `.d.ts` surface in the fixture.
// Matches the range the workspace itself develops against.
const TYPESCRIPT_VERSION_RANGE = '^5.6.3';

const MODERN_PROTOCOL_VERSION = '2026-07-28';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SUPABASE_PACKAGE_NAME = '@supabase/mcp-server-supabase';
const UTILS_PACKAGE_NAME = '@supabase/mcp-utils';

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
  },
  include: ['types-check.ts'],
};

const ESM_CHECK_SOURCE = `import { createSupabaseMcpHandler } from '${SUPABASE_PACKAGE_NAME}';

if (typeof createSupabaseMcpHandler !== 'function') {
  throw new Error(
    \`expected createSupabaseMcpHandler to be a function, got \${typeof createSupabaseMcpHandler}\`
  );
}

console.log('ESM_OK');
`;

const CJS_CHECK_SOURCE = `const { createSupabaseMcpHandler } = require('${SUPABASE_PACKAGE_NAME}');

if (typeof createSupabaseMcpHandler !== 'function') {
  throw new Error(
    \`expected createSupabaseMcpHandler to be a function, got \${typeof createSupabaseMcpHandler}\`
  );
}

console.log('CJS_OK');
`;

const TYPES_CHECK_SOURCE = `import {
  createSupabaseMcpHandler,
  type SupabaseMcpServerOptions,
} from '${SUPABASE_PACKAGE_NAME}';

// A stubbed \`account\` platform, whose seven operations only ever run on a
// tool call and so can reject here. It buys the thing that matters: asking
// for the \`account\` feature group makes the server register real tools, so
// the typecheck covers the zod-backed tool surface rather than an empty one.
const account: SupabaseMcpServerOptions['platform']['account'] = {
  listOrganizations: () => Promise.reject(new Error('not implemented')),
  getOrganization: () => Promise.reject(new Error('not implemented')),
  listProjects: () => Promise.reject(new Error('not implemented')),
  getProject: () => Promise.reject(new Error('not implemented')),
  createProject: () => Promise.reject(new Error('not implemented')),
  pauseProject: () => Promise.reject(new Error('not implemented')),
  restoreProject: () => Promise.reject(new Error('not implemented')),
};

const options: SupabaseMcpServerOptions = {
  platform: { account },
  features: ['account'],
};

const handler = createSupabaseMcpHandler(options);

// Touch every member of the public McpHttpHandler shape so a signature
// change here fails the typecheck, not just a missing export.
void handler.fetch;
void handler.close;
void handler.notify;
void handler.bus;
`;

const MODERN_CALL_SOURCE = `import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createSupabaseMcpHandler } from '${SUPABASE_PACKAGE_NAME}';

const MODERN_PROTOCOL_VERSION = '${MODERN_PROTOCOL_VERSION}';

// Stubbed \`account\` operations, which only run on a tool call, paired with
// \`features: ['account']\` so the server registers its real zod-built tool
// schemas. That is the path a zod version skew between Platform's catalog and
// the SDK's own dependency would break, so an empty catalog would not test it.
// \`docs\` stays out: its tool description lazily calls supabase.com, and this
// exchange must never leave the process.
const notImplemented = () => Promise.reject(new Error('not implemented'));

const handler = createSupabaseMcpHandler({
  platform: {
    account: {
      listOrganizations: notImplemented,
      getOrganization: notImplemented,
      listProjects: notImplemented,
      getProject: notImplemented,
      createProject: notImplemented,
      pauseProject: notImplemented,
      restoreProject: notImplemented,
    },
  },
  features: ['account'],
});

const transport = new StreamableHTTPClientTransport(
  new URL('http://packed-platform-consumer-fixture.invalid/mcp'),
  {
    // Routes every request straight into the handler's fetch face in-process.
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }
);

const client = new Client(
  { name: 'packed-platform-consumer-fixture', version: '0.0.0' },
  { versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } }
);

await client.connect(transport);
const { tools } = await client.listTools();

// A real tool carrying a real input schema, so this proves the zod-built tool
// surface survives Platform's zod version. An empty array would pass a
// transport round trip while testing none of that.
const listProjects = tools.find((tool) => tool.name === 'list_projects');

if (!listProjects?.inputSchema) {
  throw new Error(
    \`tools/list did not return list_projects with an input schema (got: \${JSON.stringify(tools.map((tool) => tool.name))})\`
  );
}

await client.close();
await handler.close();

console.log(\`MODERN_CALL_OK tools=\${tools.length}\`);
`;

/** Runs a command, streaming its own stdout/stderr straight to the console. */
function runVisible(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

/** Packs one workspace package into `destDir`, returning its packed manifest. */
function packWorkspacePackage(packageName, destDir) {
  const stdout = execFileSync(
    'pnpm',
    ['--filter', packageName, 'pack', '--json', '--pack-destination', destDir],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
  );
  const packed = JSON.parse(stdout);
  return {
    name: packed.name,
    version: packed.version,
    tarballPath: packed.filename,
  };
}

/** Runs one of the fixture's check scripts and returns its captured stdout. */
function runFixtureScript(file, cwd) {
  try {
    return execFileSync(process.execPath, [file], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(output || error.message);
  }
}

function assertMarker(output, marker, failureMessage) {
  if (!output.includes(marker)) {
    throw new Error(`${failureMessage}\n${output}`.trim());
  }
}

function assertRealDirectoryInstall(consumerDir, packageName) {
  const installedPath = path.join(
    consumerDir,
    'node_modules',
    ...packageName.split('/')
  );
  const linkStat = lstatSync(installedPath);
  if (linkStat.isSymbolicLink()) {
    throw new Error(
      `${packageName} was installed as a symlink at ${installedPath}; expected a real, ` +
        'copied directory -- workspace linkage leaked into the fixture'
    );
  }
  if (!statSync(installedPath).isDirectory()) {
    throw new Error(
      `${packageName} is not installed as a directory at ${installedPath}`
    );
  }
}

function writeFixtureProject(consumerDir, { supabase, utils }) {
  mkdirSync(consumerDir, { recursive: true });

  const packageJson = {
    name: 'packed-platform-consumer-fixture',
    private: true,
    version: '0.0.0',
    type: 'module',
    description:
      'Throwaway fixture proving @supabase/mcp-server-supabase installs and runs on a ' +
      'Platform-shaped dependency graph, outside this pnpm workspace.',
    dependencies: {
      [SUPABASE_PACKAGE_NAME]: `file:${supabase.tarballPath}`,
      [UTILS_PACKAGE_NAME]: `file:${utils.tarballPath}`,
      '@modelcontextprotocol/server': SDK_VERSION,
      '@modelcontextprotocol/client': SDK_VERSION,
      zod: PLATFORM_ZOD_VERSION,
      typescript: TYPESCRIPT_VERSION_RANGE,
    },
  };

  writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );
  writeFileSync(
    path.join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(TSCONFIG, null, 2)}\n`
  );
  writeFileSync(path.join(consumerDir, 'esm-check.mjs'), ESM_CHECK_SOURCE);
  writeFileSync(path.join(consumerDir, 'cjs-check.cjs'), CJS_CHECK_SOURCE);
  writeFileSync(path.join(consumerDir, 'types-check.ts'), TYPES_CHECK_SOURCE);
  writeFileSync(path.join(consumerDir, 'modern-call.mjs'), MODERN_CALL_SOURCE);
}

function assertEsmEntry(consumerDir) {
  assertMarker(
    runFixtureScript('esm-check.mjs', consumerDir),
    'ESM_OK',
    'ESM entry did not report success'
  );
}

function assertCjsEntry(consumerDir) {
  assertMarker(
    runFixtureScript('cjs-check.cjs', consumerDir),
    'CJS_OK',
    'CJS entry did not report success'
  );
}

function assertTypeDeclarations(consumerDir) {
  const tscBin = path.join(consumerDir, 'node_modules', '.bin', 'tsc');
  try {
    execFileSync(tscBin, ['--project', 'tsconfig.json'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(`tsc reported errors:\n${output}`);
  }
}

function assertModernCall(consumerDir) {
  assertMarker(
    runFixtureScript('modern-call.mjs', consumerDir),
    'MODERN_CALL_OK',
    'the modern MCP call did not complete'
  );
}

async function main() {
  console.log(
    'Building @supabase/mcp-utils and @supabase/mcp-server-supabase...'
  );
  runVisible(
    'pnpm',
    [
      '--filter',
      UTILS_PACKAGE_NAME,
      '--filter',
      SUPABASE_PACKAGE_NAME,
      'build',
    ],
    repoRoot
  );

  // Outside the repo tree on purpose: pnpm workspace resolution (workspace:,
  // catalog:, or symlinked node_modules) cannot reach in from here.
  const tmpRoot = mkdtempSync(
    path.join(tmpdir(), 'mcp-packed-platform-consumer-')
  );
  const tarballDir = path.join(tmpRoot, 'tarballs');
  const consumerDir = path.join(tmpRoot, 'consumer');
  mkdirSync(tarballDir, { recursive: true });

  let cleanUp = false;
  try {
    console.log('\nPacking workspace tarballs...');
    const utils = packWorkspacePackage(UTILS_PACKAGE_NAME, tarballDir);
    const supabase = packWorkspacePackage(SUPABASE_PACKAGE_NAME, tarballDir);
    console.log(`Packed ${SUPABASE_PACKAGE_NAME}@${supabase.version}`);
    console.log(`Packed ${UTILS_PACKAGE_NAME}@${utils.version}`);

    console.log(
      `\nWriting consumer fixture (zod pinned to ${PLATFORM_ZOD_VERSION})...`
    );
    writeFixtureProject(consumerDir, { supabase, utils });

    console.log('\nInstalling with plain npm (no pnpm, no workspace)...');
    runVisible('npm', ['install'], consumerDir);

    console.log(
      '\nVerifying the install is a real copy, not a workspace symlink...'
    );
    assertRealDirectoryInstall(consumerDir, SUPABASE_PACKAGE_NAME);
    assertRealDirectoryInstall(consumerDir, UTILS_PACKAGE_NAME);

    console.log('\nRunning the four public-surface assertions...');
    const assertions = [
      { name: 'esm-entry', run: () => assertEsmEntry(consumerDir) },
      { name: 'cjs-entry', run: () => assertCjsEntry(consumerDir) },
      {
        name: 'type-declarations',
        run: () => assertTypeDeclarations(consumerDir),
      },
      { name: 'modern-mcp-call', run: () => assertModernCall(consumerDir) },
    ];

    const results = [];
    for (const assertion of assertions) {
      try {
        assertion.run();
        results.push({ name: assertion.name, pass: true });
        console.log(`  [PASS] ${assertion.name}`);
      } catch (error) {
        results.push({
          name: assertion.name,
          pass: false,
          detail: error.message,
        });
        console.error(`  [FAIL] ${assertion.name}: ${error.message}`);
      }
    }

    const failed = results.filter((r) => !r.pass);

    console.log(
      `\nPacked ${SUPABASE_PACKAGE_NAME} version tested: ${supabase.version}`
    );

    if (failed.length > 0) {
      console.error(
        `\n${failed.length} of ${results.length} assertion(s) failed: ` +
          `${failed.map((r) => r.name).join(', ')}`
      );
      console.error(`Fixture left in place for inspection: ${tmpRoot}`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nAll ${results.length} assertions passed.`);
    cleanUp = true;
  } catch (error) {
    console.error(
      `\nSetup failed before assertions could run: ${error.message}`
    );
    console.error(`Fixture left in place for inspection: ${tmpRoot}`);
    process.exitCode = 1;
    return;
  } finally {
    if (cleanUp) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

await main();
