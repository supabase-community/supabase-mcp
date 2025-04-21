import 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    'msw-on-unhandled-request'?: 'error' | 'bypass' | 'warn';
  }
}
