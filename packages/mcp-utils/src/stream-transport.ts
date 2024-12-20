import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export class StreamTransport implements Transport {
  #readableStreamController?: ReadableStreamDefaultController<JSONRPCMessage>;
  #writeableStreamController?: WritableStreamDefaultController;

  ready: Promise<void>;

  readable: ReadableStream<JSONRPCMessage>;
  writable: WritableStream<JSONRPCMessage>;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor() {
    let resolveReadReady: () => void;
    let resolveWriteReady: () => void;

    const readReady = new Promise<void>((resolve) => {
      resolveReadReady = resolve;
    });

    const writeReady = new Promise<void>((resolve) => {
      resolveWriteReady = resolve;
    });

    this.ready = Promise.all([readReady, writeReady]).then(() => {});

    this.readable = new ReadableStream({
      start: (controller) => {
        this.#readableStreamController = controller;
        resolveReadReady();
      },
    });

    this.writable = new WritableStream({
      start: (controller) => {
        this.#writeableStreamController = controller;
        resolveWriteReady();
      },
      write: (message) => {
        this.onmessage?.(message);
      },
    });
  }

  async start() {
    await this.ready;
  }

  async send(message: JSONRPCMessage) {
    if (!this.#readableStreamController) {
      throw new Error('readable stream not initialized');
    }
    this.#readableStreamController.enqueue(message);
  }

  async close() {
    this.#readableStreamController?.error(new Error('connection closed'));
    this.#writeableStreamController?.error(new Error('connection closed'));
    this.onclose?.();
  }
}
