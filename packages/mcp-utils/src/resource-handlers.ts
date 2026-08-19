import type {
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult,
  Server,
} from '@modelcontextprotocol/server';

import type { ExtractParams } from './types.js';
import { assertValidUri, compareUris, matchUriTemplate } from './util.js';

export type Scheme = string;

export type Resource<Uri extends string = string, Result = unknown> = {
  uri: Uri;
  name: string;
  description?: string;
  mimeType?: string;
  read(uri: `${Scheme}://${Uri}`): Promise<Result>;
};

export type ResourceTemplate<Uri extends string = string, Result = unknown> = {
  uriTemplate: Uri;
  name: string;
  description?: string;
  mimeType?: string;
  read(
    uri: `${Scheme}://${Uri}`,
    params: {
      [Param in ExtractParams<Uri>]: string;
    }
  ): Promise<Result>;
};

/**
 * Helper function to define an MCP resource while preserving type information.
 */
export function resource<Uri extends string, Result>(
  uri: Uri,
  resource: Omit<Resource<Uri, Result>, 'uri'>
): Resource<Uri, Result> {
  return {
    uri,
    ...resource,
  };
}

/**
 * Helper function to define an MCP resource with a URI template while preserving type information.
 */
export function resourceTemplate<Uri extends string, Result>(
  uriTemplate: Uri,
  resource: Omit<ResourceTemplate<Uri, Result>, 'uriTemplate'>
): ResourceTemplate<Uri, Result> {
  return {
    uriTemplate,
    ...resource,
  };
}

/**
 * Helper function to define a JSON resource while preserving type information.
 */
export function jsonResource<Uri extends string, Result>(
  uri: Uri,
  resource: Omit<Resource<Uri, Result>, 'uri' | 'mimeType'>
): Resource<Uri, Result> {
  return {
    uri,
    mimeType: 'application/json' as const,
    ...resource,
  };
}

/**
 * Helper function to define a JSON resource with a URI template while preserving type information.
 */
export function jsonResourceTemplate<Uri extends string, Result>(
  uriTemplate: Uri,
  resource: Omit<ResourceTemplate<Uri, Result>, 'uriTemplate' | 'mimeType'>
): ResourceTemplate<Uri, Result> {
  return {
    uriTemplate,
    mimeType: 'application/json' as const,
    ...resource,
  };
}

/**
 * Helper function to define a list of resources that share a common URI scheme.
 */
export function resources<Scheme extends string>(
  scheme: Scheme,
  resources: (Resource | ResourceTemplate)[]
): (
  | Resource<`${Scheme}://${string}`>
  | ResourceTemplate<`${Scheme}://${string}`>
)[] {
  return resources.map((resource) => {
    if ('uri' in resource) {
      const url = new URL(resource.uri, `${scheme}://`);
      const uri = decodeURI(url.href) as `${Scheme}://${typeof resource.uri}`;

      return {
        ...resource,
        uri,
      };
    }

    const url = new URL(resource.uriTemplate, `${scheme}://`);
    const uriTemplate = decodeURI(
      url.href
    ) as `${Scheme}://${typeof resource.uriTemplate}`;

    return {
      ...resource,
      uriTemplate,
    };
  });
}

/**
 * Helper function to create a JSON resource response.
 */
export function jsonResourceResponse<Uri extends string, Response>(
  uri: Uri,
  response: Response
) {
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(response),
  };
}

type GetResources = () => Promise<
  (Resource<string, unknown> | ResourceTemplate<string, unknown>)[]
>;

export function registerResourceHandlers(
  server: Server,
  getResources: GetResources
) {
  server.setRequestHandler(
    'resources/list',
    async (): Promise<ListResourcesResult> => {
      const allResources = await getResources();
      return {
        resources: allResources
          .filter((resource) => 'uri' in resource)
          .map(({ uri, name, description, mimeType }) => {
            return {
              uri,
              name,
              description,
              mimeType,
            };
          }),
      };
    }
  );

  server.setRequestHandler(
    'resources/templates/list',
    async (): Promise<ListResourceTemplatesResult> => {
      const allResources = await getResources();
      return {
        resourceTemplates: allResources
          .filter((resource) => 'uriTemplate' in resource)
          .map(({ uriTemplate, name, description, mimeType }) => {
            return {
              uriTemplate,
              name,
              description,
              mimeType,
            };
          }),
      };
    }
  );

  server.setRequestHandler(
    'resources/read',
    async (request): Promise<ReadResourceResult> => {
      try {
        const allResources = await getResources();
        const { uri } = request.params;

        const resources = allResources.filter((resource) => 'uri' in resource);
        const resource = resources.find((resource) =>
          compareUris(resource.uri, uri)
        );

        if (resource) {
          const result = await resource.read(uri as `${string}://${string}`);
          const contents = Array.isArray(result) ? result : [result];

          return { contents };
        }

        const resourceTemplates = allResources.filter(
          (resource) => 'uriTemplate' in resource
        );
        const resourceTemplateUris = resourceTemplates.map(({ uriTemplate }) =>
          assertValidUri(uriTemplate)
        );
        const templateMatch = matchUriTemplate(uri, resourceTemplateUris);

        if (!templateMatch) {
          throw new Error('resource not found');
        }

        const resourceTemplate = resourceTemplates.find(
          (resource) => resource.uriTemplate === templateMatch.uri
        );

        if (!resourceTemplate) {
          throw new Error('resource not found');
        }

        const result = await resourceTemplate.read(
          uri as `${string}://${string}`,
          templateMatch.params
        );
        const contents = Array.isArray(result) ? result : [result];

        return { contents };
      } catch (error) {
        // The SDK's legacy resource-error projection is not part of ReadResourceResult.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: enumerateError(error) }),
            },
          ],
        } as unknown as ReadResourceResult;
      }
    }
  );
}

export function enumerateError(error: unknown) {
  if (!error) {
    return error;
  }

  if (typeof error !== 'object') {
    return error;
  }

  const newError: Record<string, unknown> = {};

  const errorProps = ['name', 'message'] as const;

  for (const prop of errorProps) {
    if (prop in error) {
      newError[prop] = (error as Record<string, unknown>)[prop];
    }
  }

  return newError;
}
