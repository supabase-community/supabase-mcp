import { readFile } from 'fs/promises';
import { Plugin } from 'vite';

export function textLoaderPlugin(extension: string): Plugin {
  return {
    name: 'text-loader',
    async transform(code, id) {
      if (id.endsWith(extension)) {
        const textContent = await readFile(id, 'utf8');
        return `export default ${JSON.stringify(textContent)};`;
      }
      return code;
    },
  };
}
