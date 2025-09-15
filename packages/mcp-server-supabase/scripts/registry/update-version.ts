import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageJsonPath = fileURLToPath(
  import.meta.resolve('../../package.json')
);
const serverJsonPath = fileURLToPath(import.meta.resolve('../../server.json'));

try {
  // Read package.json to get the version
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
  const { name, version } = packageJson;

  if (!version) {
    console.error('No version found in package.json');
    process.exit(1);
  }

  // Read server.json
  const serverJson = JSON.parse(await readFile(serverJsonPath, 'utf-8'));

  // Update version in server.json root
  serverJson.version = version;

  // Update version in packages array
  if (serverJson.packages && Array.isArray(serverJson.packages)) {
    for (const pkg of serverJson.packages) {
      if (pkg.identifier === name) {
        pkg.version = version;
      }
    }
  }

  // Write updated server.json
  await writeFile(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');

  console.log(`Updated server.json version to ${version}`);
} catch (error) {
  console.error('Failed to update server.json version:', error);
  process.exit(1);
}
