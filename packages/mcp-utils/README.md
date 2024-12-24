# @supabase/mcp-utils

A collection of utilities for working with the Model Context Protocol (MCP).

## Installation

```shell
npm i @supabase/mcp-utils
```

```shell
yarn add @supabase/mcp-utils
```

```shell
pnpm add @supabase/mcp-utils
```

## API

### `StreamTransport`

If you're building an MCP client, you'll need to connect to MCP servers programmatically using a [transport](https://modelcontextprotocol.io/docs/concepts/transports).

In addition to MCP's [built-in](https://modelcontextprotocol.io/docs/concepts/transports#built-in-transport-types) transports, we also offer a `StreamTransport` to connect to clients with servers directly in-memory or over your own stream-based transport:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { PostgrestMcpServer } from '@supabase/mcp-server-postgrest';

// Create a stream transport for both client and server
const clientTransport = new StreamTransport();
const serverTransport = new StreamTransport();

// Connect the streams together
clientTransport.readable.pipeTo(serverTransport.writable);
serverTransport.readable.pipeTo(clientTransport.writable);

const client = new Client(
  {
    name: 'MyClient',
    version: '0.1.0',
  },
  {
    capabilities: {},
  }
);

const server = new PostgrestMcpServer({
  apiUrl: API_URL,
  schema: 'public',
});

// Connect the client and server to their respective transports
await server.connect(serverTransport);
await client.connect(clientTransport);
```

A `StreamTransport` implements a standard duplex stream interface via [`ReadableStream`](https://developer.mozilla.org/docs/Web/API/ReadableStream) and [`WritableStream`](https://developer.mozilla.org/docs/Web/API/WritableStream):

```ts
interface StreamTransport {
  readable: ReadableStream;
  writable: WritableStream;
}
```

You can use `pipeTo` or `pipeThrough` to connect or transform streams. For more information, see the [Web Streams API](https://developer.mozilla.org/docs/Web/API/Streams_API).

If your using Node.js streams, you can use their [`.toWeb()`](https://nodejs.org/api/stream.html#streamduplextowebstreamduplex) and [`.fromWeb()`](https://nodejs.org/api/stream.html#streamduplexfromwebpair-options) methods to convert to and from web standard streams.

The full interface for `StreamTransport` is as follows:

```ts
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

interface DuplexStream<T> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}

declare class StreamTransport
  implements Transport, DuplexStream<JSONRPCMessage>
{
  ready: Promise<void>;
  readable: ReadableStream<JSONRPCMessage>;
  writable: WritableStream<JSONRPCMessage>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor();
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
}
```
