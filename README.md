# Supabase MCP Servers

> A collection of MCP servers that connect LLMs to Supabase

[![smithery badge](https://smithery.ai/badge/@supabase-community/mcp-supabase)](https://smithery.ai/server/@supabase-community/mcp-supabase)

The [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) is a standard for connecting Large Language Models (LLMs) to external services. It is an interface that provides custom resources, tools, and prompts to LLMs. This repository contains a collection of MCP servers that interface with Supabase.

## MCP clients vs. servers

MCP clients are applications running LLMs in some form (often a chat interface), while servers are external services that provide the data and functionality that the LLMs interact with. Both clients and servers must be MCP-compatible to communicate with each other.

[Claude desktop](https://claude.ai/download) is an example of an MCP-compatible client.

## Example

You could connect [`@supabase/mcp-server-postgrest`](./packages/mcp-server-postgrest) with [Claude desktop](https://claude.ai/download) to query your Supabase database _(or any other Postgres database)_ via Claude's chat interface, with the PostgREST API handling communication under the hood.

## Supabase MCP servers

- [PostgREST](./packages/mcp-server-postgrest) _`@supabase/mcp-server-postgrest`_: Connect your Supabase project _(or any other PostgREST server)_ to an LLM using PostgREST as the API layer.

- Management API _(coming soon)_: Manage your Supabase project, schema, and DDL using an LLM.

## Resources

- [**Model Context Protocol**](https://modelcontextprotocol.io/introduction): Learn more about MCP and its capabilities.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
