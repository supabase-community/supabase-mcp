import { serve } from "@modelcontextprotocol/server-http";
import { createServer } from "@supabase-community/mcp-server-supabase";

const mcp = createServer({
  accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  projectRef: process.env.SUPABASE_PROJECT_REF,
  readOnly: true
});

export default serve(mcp);
