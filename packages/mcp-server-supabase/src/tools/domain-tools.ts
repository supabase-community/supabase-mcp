import { z } from 'zod';
import type { CustomDomainOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface DomainToolsOptions {
  customDomain: CustomDomainOperations;
  projectId?: string;
}

export function getDomainTools({
  customDomain,
  projectId,
}: DomainToolsOptions) {
  const project_id = projectId;

  const domainTools = {
    get_custom_hostname: injectableTool({
      description:
        'Retrieves the custom hostname configuration for a project.',
      annotations: {
        title: 'Get custom hostname',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const hostname = await customDomain.getCustomHostname(project_id);
        return source`
          Custom Hostname Configuration:
          ${JSON.stringify(hostname, null, 2)}
        `;
      },
    }),

    create_custom_hostname: injectableTool({
      description:
        'Creates a custom hostname for a project. This allows using a custom domain instead of the default Supabase domain.',
      annotations: {
        title: 'Create custom hostname',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        hostname: z
          .string()
          .describe('The custom hostname (e.g., api.example.com)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, hostname }) => {
        const created = await customDomain.createCustomHostname(project_id, hostname);
        return source`
          Custom hostname created:
          ${JSON.stringify(created, null, 2)}

          Next steps:
          1. Add the provided CNAME record to your DNS
          2. Wait for DNS propagation
          3. Activate the custom hostname
        `;
      },
    }),

    initialize_custom_hostname: injectableTool({
      description:
        'Initializes the custom hostname setup process and returns DNS configuration requirements.',
      annotations: {
        title: 'Initialize custom hostname',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const config = await customDomain.initializeCustomHostname(project_id);
        return source`
          Custom hostname initialization:
          ${JSON.stringify(config, null, 2)}
        `;
      },
    }),

    activate_custom_hostname: injectableTool({
      description:
        'Activates a custom hostname after DNS records have been configured.',
      annotations: {
        title: 'Activate custom hostname',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const activated = await customDomain.activateCustomHostname(project_id);
        return source`
          Custom hostname activated:
          ${JSON.stringify(activated, null, 2)}
        `;
      },
    }),

    reverify_custom_hostname: injectableTool({
      description:
        'Re-verifies DNS configuration for a custom hostname.',
      annotations: {
        title: 'Reverify custom hostname',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const status = await customDomain.reverifyCustomHostname(project_id);
        return source`
          Custom hostname reverification:
          ${JSON.stringify(status, null, 2)}
        `;
      },
    }),

    delete_custom_hostname: injectableTool({
      description:
        'Removes the custom hostname configuration from a project.',
      annotations: {
        title: 'Delete custom hostname',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        await customDomain.deleteCustomHostname(project_id);
        return source`
          Custom hostname has been removed.
        `;
      },
    }),

    get_vanity_subdomain: injectableTool({
      description:
        'Retrieves the vanity subdomain configuration for a project.',
      annotations: {
        title: 'Get vanity subdomain',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const subdomain = await customDomain.getVanitySubdomain(project_id);
        return source`
          Vanity Subdomain Configuration:
          ${JSON.stringify(subdomain, null, 2)}
        `;
      },
    }),

    create_vanity_subdomain: injectableTool({
      description:
        'Creates a vanity subdomain for a project (e.g., myapp.supabase.co instead of random-project-id.supabase.co).',
      annotations: {
        title: 'Create vanity subdomain',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        subdomain: z
          .string()
          .describe('The vanity subdomain (e.g., myapp)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, subdomain }) => {
        const created = await customDomain.createVanitySubdomain(project_id, subdomain);
        return source`
          Vanity subdomain created:
          ${JSON.stringify(created, null, 2)}
        `;
      },
    }),

    check_subdomain_availability: injectableTool({
      description:
        'Checks if a vanity subdomain is available for use.',
      annotations: {
        title: 'Check subdomain availability',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        subdomain: z
          .string()
          .describe('The subdomain to check'),
      }),
      inject: { project_id },
      execute: async ({ project_id, subdomain }) => {
        const availability = await customDomain.checkSubdomainAvailability(
          project_id,
          subdomain
        );
        return source`
          Subdomain Availability Check:
          Subdomain: ${subdomain}
          ${JSON.stringify(availability, null, 2)}
        `;
      },
    }),

    activate_vanity_subdomain: injectableTool({
      description:
        'Activates a vanity subdomain after it has been created.',
      annotations: {
        title: 'Activate vanity subdomain',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const activated = await customDomain.activateVanitySubdomain(project_id);
        return source`
          Vanity subdomain activated:
          ${JSON.stringify(activated, null, 2)}
        `;
      },
    }),

    delete_vanity_subdomain: injectableTool({
      description:
        'Removes the vanity subdomain from a project.',
      annotations: {
        title: 'Delete vanity subdomain',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        await customDomain.deleteVanitySubdomain(project_id);
        return source`
          Vanity subdomain has been removed.
        `;
      },
    }),
  };

  return domainTools;
}