import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  Client,
  PROTOCOL_VERSION_META_KEY,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import type { Poc } from '../src/server.js';

export type WireFrame = {
  direction: 'request' | 'response';
  status?: number;
  body: any;
};

export type TestClientOptions = {
  poc: Poc;
  bearer?: string;
  elicitation?:
    | false
    | ((req: { message: string; requestedSchema: any }) => {
        action: 'accept' | 'decline' | 'cancel';
        content?: Record<string, unknown>;
      });
};

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createTestClient(opts: TestClientOptions): Promise<{
  client: Client;
  wire: WireFrame[];
  close(): Promise<void>;
}> {
  const wire: WireFrame[] = [];
  const bearer = opts.bearer ?? 'user-alice';
  const capturedFetch: typeof fetch = async (input, init) => {
    const outgoing = new Request(input, init);
    wire.push({
      direction: 'request',
      body: parseBody(await outgoing.clone().text()),
    });
    const response = await opts.poc.handler.fetch(outgoing);
    wire.push({
      direction: 'response',
      status: response.status,
      body: parseBody(await response.clone().text()),
    });
    return response;
  };

  const responder = opts.elicitation;
  const declaresElicitation = typeof responder === 'function';
  const client = new Client(
    { name: 'mcp-elicitations-poc-test', version: '0.0.0' },
    {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
      capabilities: declaresElicitation ? { elicitation: { form: {} } } : {},
    }
  );

  if (typeof responder === 'function') {
    client.setRequestHandler('elicitation/create', async (request) => {
      const response = responder({
        message: request.params.message,
        requestedSchema:
          'requestedSchema' in request.params
            ? request.params.requestedSchema
            : undefined,
      });
      return response as any;
    });
  }

  const transport = new StreamableHTTPClientTransport(
    new URL('http://poc.local/mcp'),
    {
      fetch: capturedFetch,
      requestInit: {
        headers: { Authorization: `Bearer ${bearer}` },
      },
    }
  );
  await client.connect(transport);

  return {
    client,
    wire,
    close: () => client.close(),
  };
}

export async function rawToolCall(opts: {
  poc: Poc;
  bearer?: string;
  declareElicitation?: boolean;
  args: Record<string, unknown>;
  inputResponses?: Record<string, unknown>;
  requestState?: string;
}): Promise<{ status: number; body: any }> {
  const capabilities = opts.declareElicitation
    ? { elicitation: { form: {} } }
    : {};
  const params: Record<string, unknown> = {
    name: 'create_project',
    arguments: opts.args,
  };
  if (opts.inputResponses !== undefined) {
    params.inputResponses = opts.inputResponses;
  }
  if (opts.requestState !== undefined) params.requestState = opts.requestState;

  const body = {
    jsonrpc: '2.0',
    id: randomId(),
    method: 'tools/call',
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
        [CLIENT_INFO_META_KEY]: {
          name: 'mcp-elicitations-poc-raw-test',
          version: '0.0.0',
        },
        [CLIENT_CAPABILITIES_META_KEY]: capabilities,
      },
    },
  };
  const response = await opts.poc.handler.fetch(
    new Request('http://poc.local/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.bearer ?? 'user-alice'}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'create_project',
      },
      body: JSON.stringify(body),
    })
  );
  return {
    status: response.status,
    body: parseBody(await response.text()),
  };
}

let nextId = 1;
function randomId(): number {
  return nextId++;
}
