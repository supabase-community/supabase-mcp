import { codeBlock } from 'common-tags';
import { open, type FileHandle } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { bundleFiles, extractFiles } from './eszip.js';

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

export class Source implements UnderlyingSource<Uint8Array> {
  type = 'bytes' as const;
  autoAllocateChunkSize = 1024;

  path: string | URL;
  controller?: ReadableByteStreamController;
  file?: FileHandle;

  constructor(path: string | URL) {
    this.path = path;
  }

  async start(controller: ReadableStreamController<Uint8Array>) {
    if (!('byobRequest' in controller)) {
      throw new Error('ReadableStreamController does not support byobRequest');
    }

    this.file = await open(this.path);
    this.controller = controller;
  }

  async pull() {
    if (!this.controller || !this.file) {
      throw new Error('ReadableStream has not been started');
    }

    if (!this.controller.byobRequest) {
      throw new Error('ReadableStreamController does not support byobRequest');
    }

    const view = this.controller.byobRequest.view as NodeJS.ArrayBufferView;

    if (!view) {
      throw new Error('ReadableStreamController does not have a view');
    }

    const { bytesRead } = await this.file.read({
      buffer: view,
      offset: view.byteOffset,
      length: view.byteLength,
    });

    if (bytesRead === 0) {
      await this.file.close();
      this.controller.close();
    }

    this.controller.byobRequest.respond(view.byteLength);
  }
}
