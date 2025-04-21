import { codeBlock } from 'common-tags';
import { describe, expect, test } from 'vitest';
import { bundleFiles, extractFiles } from './index.js';

describe('eszip', () => {
  test('extract files', async () => {
    const helloContent = codeBlock`
      export function hello(): string {
        return 'Hello, world!';
      }
    `;
    const helloFile = new File([helloContent], 'hello.ts', {
      type: 'application/typescript',
    });

    const indexContent = codeBlock`
      import { hello } from './hello.ts';

      Deno.serve(async (req: Request) => {
        return new Response(hello(), { headers: { 'Content-Type': 'text/plain' } })
      });
    `;
    const indexFile = new File([indexContent], 'index.ts', {
      type: 'application/typescript',
    });

    const eszip = await bundleFiles([indexFile, helloFile]);
    const extractedFiles = await extractFiles(eszip);

    expect(extractedFiles).toHaveLength(2);

    const extractedIndexFile = extractedFiles.find(
      (file) => file.name === 'index.ts'
    );
    const extractedHelloFile = extractedFiles.find(
      (file) => file.name === 'hello.ts'
    );

    expect(extractedIndexFile).toBeDefined();
    expect(extractedIndexFile!.type).toBe('application/typescript');
    await expect(extractedIndexFile!.text()).resolves.toBe(indexContent);

    expect(extractedHelloFile).toBeDefined();
    expect(extractedHelloFile!.type).toBe('application/typescript');
    await expect(extractedHelloFile!.text()).resolves.toBe(helloContent);
  });
});
