import { build, Parser } from '@deno/eszip';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const parser = await Parser.createInstance();
const sourceMapSchema = z.object({
  version: z.number(),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string()).optional(),
  names: z.array(z.string()),
  mappings: z.string(),
});

/**
 * Extracts source files from an eszip archive.
 *
 * Optionally removes the given path prefix from file names.
 *
 * If a file contains a source map, it will return the
 * original TypeScript source instead of the transpiled file.
 */
export async function extractFiles(
  eszip: Uint8Array,
  pathPrefix: string = '/'
) {
  let specifiers: string[] = [];

  if (eszip instanceof ReadableStream) {
    const reader = eszip.getReader({ mode: 'byob' });
    specifiers = await parser.parse(reader);
  } else {
    specifiers = await parser.parseBytes(eszip);
  }

  await parser.load();

  const fileSpecifiers = specifiers.filter((specifier) =>
    specifier.startsWith('file://')
  );

  const files = await Promise.all(
    fileSpecifiers.map(async (specifier) => {
      const source: string = await parser.getModuleSource(specifier);
      const sourceMapString: string =
        await parser.getModuleSourceMap(specifier);

      const filePath = relative(pathPrefix, fileURLToPath(specifier));

      const file = new File([source], filePath, {
        type: 'text/plain',
      });

      if (!sourceMapString) {
        return file;
      }

      const sourceMap = sourceMapSchema.parse(JSON.parse(sourceMapString));

      const [typeScriptSource] = sourceMap.sourcesContent ?? [];

      if (!typeScriptSource) {
        return file;
      }

      const sourceFile = new File([typeScriptSource], filePath, {
        type: 'application/typescript',
      });

      return sourceFile;
    })
  );

  return files;
}

/**
 * Bundles files into an eszip archive.
 *
 * Optionally prefixes the file names with a given path.
 */
export async function bundleFiles(files: File[], pathPrefix: string = '/') {
  const specifiers = files.map(
    (file) => `file://${join(pathPrefix, file.name)}`
  );
  const eszip = await build(specifiers, async (specifier: string) => {
    if (specifier.startsWith('file://')) {
      const file = files.find(
        (file) => `file://${join(pathPrefix, file.name)}` === specifier
      );

      if (!file) {
        throw new Error(`File not found: ${specifier}`);
      }

      return {
        kind: 'module',
        specifier,
        headers: {
          'content-type': file.type,
        },
        content: await file.text(),
      };
    }
  });

  return eszip;
}
