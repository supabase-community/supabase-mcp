import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  isInitializeRequest,
  isJSONRPCError,
  isJSONRPCRequest,
  isJSONRPCResponse,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Stateless HTTP transport based on the official `StreamableHTTPServerTransport`
 * but built on web standards and is runtime agnostic (not tied to Node.js).
 *
 * This transport is suitable for serverless environments like Supabase Edge Functions.
 */
export class StatelessHttpServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  #incomingMessages?: JSONRPCMessage[];
  #outgoingMessages?: JSONRPCMessage[];
  #responseWriter?: WritableStreamDefaultWriter<JSONRPCMessage>;

  get allResponsesSent(): boolean {
    const rpcRequests = this.#incomingMessages?.filter(isJSONRPCRequest);
    const rpcResponses = this.#outgoingMessages?.filter(isJSONRPCResponse);
    return !!rpcRequests?.every(
      (rpcRequest) =>
        !!rpcResponses?.some((rpcResponse) => rpcResponse.id === rpcRequest.id)
    );
  }

  /**
   * Handles an incoming HTTP request, always POST for stateless transport.
   */
  async handleRequest(req: Request): Promise<Response> {
    console.log('got request', req.method, req.url);
    try {
      if (req.method !== 'POST') {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.ConnectionClosed,
              message: 'Method not allowed.',
            },
            id: null,
          },
          {
            status: 405,
            headers: {
              Allow: 'POST',
            },
          }
        );
      }
      const acceptHeader = req.headers.get('accept');
      // The client MUST include an Accept header, listing both application/json
      // and text/event-stream as supported content types.
      if (
        !acceptHeader?.includes('application/json') ||
        !acceptHeader.includes('text/event-stream')
      ) {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.ConnectionClosed,
              message:
                'Not Acceptable: Client must accept both application/json and text/event-stream',
            },
            id: null,
          },
          {
            status: 406,
          }
        );
      }

      const contentType = req.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.ConnectionClosed,
              message:
                'Unsupported Media Type: Content-Type must be application/json',
            },
            id: null,
          },
          {
            status: 415,
          }
        );
      }

      // TODO: Limit to 4MB
      const rawMessage = await req.json();
      const rawMessages = Array.isArray(rawMessage) ? rawMessage : [rawMessage];
      const messages = rawMessages.map((msg) =>
        JSONRPCMessageSchema.parse(msg)
      );
      console.log('parsed messages', messages);
      this.#incomingMessages = messages;

      const isInitializationRequest = messages.some(isInitializeRequest);
      if (isInitializationRequest) {
        // The initialize request cannot be part of a JSON-RPC batch
        // other requests and notifications are not possible until initialization has completed
        if (messages.length > 1) {
          return Response.json(
            {
              jsonrpc: '2.0',
              error: {
                code: ErrorCode.InvalidRequest,
                message:
                  'Invalid Request: Only one initialization request is allowed',
              },
              id: null,
            },
            {
              status: 400,
            }
          );
        }
      }

      // Check for RPC requests (vs. notifications or responses)
      const rpcRequests = messages.filter(isJSONRPCRequest);

      // If the RPC messages only contain notifications or responses, return 202
      if (rpcRequests.length === 0) {
        // Defer message processing to the next tick so that we can send a response immediately
        queueMicrotask(() => {
          for (const message of messages) {
            this.onmessage?.(message);
          }
        });
        console.log('no RPC requests, returning 202');
        return new Response(null, {
          status: 202,
        });
      }

      // Otherwise prepare SSE response
      const responseStream = new JsonRpcToSseStream();
      this.#responseWriter = responseStream.writable.getWriter();

      const response = new Response(responseStream.readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });

      // Defer message processing to the next tick so that we can send a response immediately
      // queueMicrotask(() => {
      for (const message of messages) {
        this.onmessage?.(message);
      }
      // });

      // Note returning the response does not close the HTTP connection.
      // The connection will remain open until all RPC responses are sent
      // as SSE messages via send() or until the client closes the connection.
      return response;
    } catch (error) {
      if (!(error instanceof Error)) {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: {
              code: ErrorCode.InternalError,
              message: 'Internal error',
            },
            id: null,
          },
          {
            status: 500,
          }
        );
      }

      this.onerror?.(error);

      return Response.json(
        {
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.ParseError,
            message: 'Parse error',
            data: String(error),
          },
          id: null,
        },
        {
          status: 400,
        }
      );
    }
  }

  /**
   * Start is a no-op for stateless transports.
   */
  async start() {}

  /**
   * Sends a JSON-RPC message to the client.
   */
  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    console.log('sending message', message);

    if (!this.#responseWriter) {
      throw new Error('No HTTP connection established');
    }

    // If the message isn't a response or error, discard it
    if (!isJSONRPCResponse(message) && !isJSONRPCError(message)) {
      return;
    }

    let requestId = message.id ?? options?.relatedRequestId;

    // If there is no associated request ID, discard the message
    if (requestId === undefined) {
      return;
    }

    if (!this.#outgoingMessages) {
      this.#outgoingMessages = [];
    }
    this.#outgoingMessages.push(message);

    // Write this to the SSE response stream
    await this.#responseWriter.write(message);

    if (this.allResponsesSent) {
      console.log('all responses sent, closing response stream');
      // Close the response stream (closes the underlying HTTP connection)
      await this.#responseWriter.close();
    }
  }

  async close() {
    this.onclose?.();
  }
}

class JsonRpcToSseStream extends TransformStream<JSONRPCMessage, Uint8Array> {
  #textEncoder = new TextEncoder();

  /**
   * Transforms JSON-RPC messages into SSE messages.
   */
  constructor() {
    super({
      transform: (message, controller) => {
        let eventData = `event: message\n`;
        eventData += `data: ${JSON.stringify(message)}\n\n`;
        controller.enqueue(this.#textEncoder.encode(eventData));
      },
    });
  }
}
