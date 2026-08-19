import { Server } from '@modelcontextprotocol/server';
import type {
  ClientCapabilities,
  Implementation,
  ServerCapabilities,
  ServerOptions,
} from '@modelcontextprotocol/server';

import {
  jsonResource,
  jsonResourceResponse,
  jsonResourceTemplate,
  registerResourceHandlers,
  resource,
  resources,
  resourceTemplate,
  type Resource,
  type ResourceTemplate,
  type Scheme,
} from './resource-handlers.js';
import {
  registerToolHandlers,
  tool,
  type Annotations,
  type Prop,
  type PropCallback,
  type Tool,
  type ToolCallCallback,
  type ToolCallDetails,
  type ToolInput,
  type ToolPolicyCallCallback,
  type ToolPolicyCallDetails,
} from './tool-handlers.js';
import type { ToolRequestInputs } from './tool-policy.js';

export {
  jsonResource,
  jsonResourceResponse,
  jsonResourceTemplate,
  resource,
  resources,
  resourceTemplate,
  tool,
};
export type {
  Annotations,
  Prop,
  PropCallback,
  Resource,
  ResourceTemplate,
  Scheme,
  Tool,
  ToolCallDetails,
  ToolInput,
  ToolPolicyCallDetails,
};

export type InitData = {
  clientInfo: Implementation;
  clientCapabilities: ClientCapabilities;
};

export type InitCallback = (initData: InitData) => void | Promise<void>;
export type { ToolCallCallback, ToolPolicyCallCallback };

export type McpServerOptions = {
  /**
   * The name of the MCP server. This will be sent to the client as part of
   * the initialization process.
   */
  name: string;

  /**
   * The title of the MCP server. This is a human-readable name that can be
   * displayed in the client UI.
   *
   * If not provided, the name will be used as the title.
   */
  title?: string;

  /**
   * The version of the MCP server. This will be sent to the client as part of
   * the initialization process.
   */
  version: string;

  /**
   * Callback for when initialization has fully completed with the client.
   */
  onInitialize?: InitCallback;

  /**
   * Optional instructions describing how to use the server and its features.
   *
   * This can be used by clients to improve the LLM's understanding of available
   * tools, resources, etc. It can be thought of like a "hint" to the model.
   * For example, this information MAY be added to the system prompt.
   */
  instructions?: string;

  /**
   * Callback for after a tool is called.
   */
  onToolCall?: ToolCallCallback;
  /**
   * Callback for each pre-execution policy decision.
   */
  onToolPolicyCall?: ToolPolicyCallCallback;

  /**
   * Serving-path inputs for normalized tool request context.
   */
  toolRequestInputs?: ToolRequestInputs;
  /**
   * Continuation state verifier passed through to the MCP server.
   */
  requestState?: ServerOptions['requestState'];

  /**
   * Resources to be served by the server. These can be defined as a static
   * object or as a function that dynamically returns the object synchronously
   * or asynchronously.
   *
   * If defined as a function, the function will be called whenever the client
   * asks for the list of resources or reads a resource. This allows for dynamic
   * resources that can change after the server has started.
   */
  resources?: Prop<
    (Resource<string, unknown> | ResourceTemplate<string, unknown>)[]
  >;

  /**
   * Tools to be served by the server. These can be defined as a static object
   * or as a function that dynamically returns the object synchronously or
   * asynchronously.
   *
   * If defined as a function, the function will be called whenever the client
   * asks for the list of tools or invokes a tool. This allows for dynamic tools
   * that can change after the server has started.
   */
  tools?: Prop<Record<string, Tool<any, any, any, any>>>;
};

/**
 * Creates an MCP server with the given options.
 *
 * Simplifies the process of creating an MCP server by providing a high-level
 * API for defining resources and tools.
 */
export function createMcpServer(options: McpServerOptions) {
  const capabilities: ServerCapabilities = {};

  if (options.resources) {
    capabilities.resources = {};
  }

  if (options.tools) {
    capabilities.tools = {};
  }

  const server = new Server(
    {
      name: options.name,
      title: options.title,
      version: options.version,
    },
    {
      capabilities,
      instructions: options.instructions,
      requestState: options.requestState,
    }
  );

  server.oninitialized = async () => {
    const clientInfo = server.getClientVersion();
    const clientCapabilities = server.getClientCapabilities();

    if (!clientInfo) {
      throw new Error('client info not available after initialization');
    }

    if (!clientCapabilities) {
      throw new Error('client capabilities not available after initialization');
    }

    const initData: InitData = {
      clientInfo,
      clientCapabilities,
    };

    await options.onInitialize?.(initData);
  };

  if (options.resources) {
    const getResources = async () => {
      if (!options.resources) {
        throw new Error('resources not available');
      }

      return typeof options.resources === 'function'
        ? await options.resources()
        : options.resources;
    };
    registerResourceHandlers(server, getResources);
  }

  if (options.tools) {
    const getTools = async () => {
      if (!options.tools) {
        throw new Error('tools not available');
      }

      return typeof options.tools === 'function'
        ? await options.tools()
        : options.tools;
    };
    registerToolHandlers({
      server,
      getTools,
      toolRequestInputs: options.toolRequestInputs,
      onToolCall: options.onToolCall,
      onToolPolicyCall: options.onToolPolicyCall,
    });
  }

  return server;
}
