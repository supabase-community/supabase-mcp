import { createServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";

import { createPoc } from "./server.js";

const { handler } = createPoc();
const server = createServer(toNodeHandler(handler));

server.listen(3900, () => {
  console.log("MCP Elicitations PoC listening on http://localhost:3900/mcp");
});
