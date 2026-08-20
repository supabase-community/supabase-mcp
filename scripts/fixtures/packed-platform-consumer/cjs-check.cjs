const { createSupabaseMcpHandler } = require('@supabase/mcp-server-supabase');

if (typeof createSupabaseMcpHandler !== 'function') {
  throw new Error(
    `expected createSupabaseMcpHandler to be a function, got ${typeof createSupabaseMcpHandler}`
  );
}

console.log('CJS_OK');
