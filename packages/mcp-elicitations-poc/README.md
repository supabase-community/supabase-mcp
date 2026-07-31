# MCP Elicitations PoC

Standalone proof of concept for MCP 2026-07-28 form-mode multi round-trip
elicitation around mock project cost confirmation.

From the repository root:

```sh
pnpm install
```

From this package:

```sh
pnpm dev
pnpm test
```

The development server listens at `http://localhost:3900/mcp`. All project
operations use an in-memory mock registry.
