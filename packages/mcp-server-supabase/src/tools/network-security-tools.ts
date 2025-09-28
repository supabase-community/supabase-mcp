import { z } from 'zod';
import type { NetworkSecurityOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface NetworkSecurityToolsOptions {
  networkSecurity: NetworkSecurityOperations;
  projectId?: string;
}

export function getNetworkSecurityTools({
  networkSecurity,
  projectId,
}: NetworkSecurityToolsOptions) {
  const project_id = projectId;

  const networkSecurityTools = {
    get_network_restrictions: injectableTool({
      description:
        'Retrieves network restrictions (allowed IP addresses and CIDR blocks) for a project.',
      annotations: {
        title: 'Get network restrictions',
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
        const restrictions = await networkSecurity.getNetworkRestrictions(project_id);
        return source`
          Network Restrictions:
          ${JSON.stringify(restrictions, null, 2)}
        `;
      },
    }),

    update_network_restrictions: injectableTool({
      description:
        'Updates network restrictions for a project. Specify allowed IP addresses or CIDR blocks.',
      annotations: {
        title: 'Update network restrictions',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        allowed_ips: z
          .array(z.string())
          .describe('List of allowed IP addresses or CIDR blocks (e.g., 192.168.1.0/24)'),
        enabled: z
          .boolean()
          .describe('Whether to enable network restrictions'),
      }),
      inject: { project_id },
      execute: async ({ project_id, allowed_ips, enabled }) => {
        const updated = await networkSecurity.updateNetworkRestrictions(project_id, {
          allowed_ips: allowed_ips,
          enabled,
        });
        return source`
          Network restrictions updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    apply_network_restrictions: injectableTool({
      description:
        'Applies pending network restriction changes to a project.',
      annotations: {
        title: 'Apply network restrictions',
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
        await networkSecurity.applyNetworkRestrictions(project_id);
        return source`
          Network restrictions applied successfully.
        `;
      },
    }),

    get_ssl_enforcement: injectableTool({
      description:
        'Retrieves SSL enforcement configuration for a project.',
      annotations: {
        title: 'Get SSL enforcement',
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
        const enforcement = await networkSecurity.getSSLEnforcement(project_id);
        return source`
          SSL Enforcement Configuration:
          ${JSON.stringify(enforcement, null, 2)}
        `;
      },
    }),

    update_ssl_enforcement: injectableTool({
      description:
        'Updates SSL enforcement configuration for database connections.',
      annotations: {
        title: 'Update SSL enforcement',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        enforced: z
          .boolean()
          .describe('Whether to enforce SSL for database connections'),
        mode: z
          .enum(['require', 'verify-ca', 'verify-full'])
          .optional()
          .describe('SSL verification mode'),
      }),
      inject: { project_id },
      execute: async ({ project_id, enforced, mode }) => {
        const updated = await networkSecurity.updateSSLEnforcement(project_id, {
          enforced,
          mode,
        });
        return source`
          SSL enforcement updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    add_network_ban: injectableTool({
      description:
        'Adds an IP address or CIDR block to the network ban list.',
      annotations: {
        title: 'Add network ban',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        ip_address: z
          .string()
          .describe('IP address or CIDR block to ban'),
        reason: z
          .string()
          .optional()
          .describe('Reason for the ban'),
        duration: z
          .number()
          .optional()
          .describe('Ban duration in seconds (permanent if not specified)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, ip_address, reason, duration }) => {
        const ban = await networkSecurity.addNetworkBan(project_id, {
          ip_address,
          reason,
          duration,
        });
        return source`
          Network ban added:
          ${JSON.stringify(ban, null, 2)}
        `;
      },
    }),

    remove_network_ban: injectableTool({
      description:
        'Removes an IP address or CIDR block from the network ban list.',
      annotations: {
        title: 'Remove network ban',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        ip_address: z
          .string()
          .describe('IP address or CIDR block to unban'),
      }),
      inject: { project_id },
      execute: async ({ project_id, ip_address }) => {
        await networkSecurity.removeNetworkBan(project_id, ip_address);
        return source`
          Network ban removed for IP: ${ip_address}
        `;
      },
    }),

    configure_read_replicas: injectableTool({
      description:
        'Configures read replica settings for a project.',
      annotations: {
        title: 'Configure read replicas',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        enabled: z.boolean(),
        regions: z
          .array(z.string())
          .optional()
          .describe('Regions to deploy read replicas'),
        max_replicas: z
          .number()
          .optional()
          .describe('Maximum number of read replicas'),
      }),
      inject: { project_id },
      execute: async ({ project_id, enabled, regions, max_replicas }) => {
        const config = await networkSecurity.configureReadReplicas(project_id, {
          enabled,
          regions,
          max_replicas,
        });
        return source`
          Read replica configuration updated:
          ${JSON.stringify(config, null, 2)}
        `;
      },
    }),

    setup_read_replica: injectableTool({
      description:
        'Sets up a new read replica in a specific region.',
      annotations: {
        title: 'Setup read replica',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        region: z
          .string()
          .describe('Region to deploy the read replica'),
        size: z
          .enum(['small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge', '8xlarge', '12xlarge', '16xlarge'])
          .optional()
          .describe('Instance size for the read replica'),
      }),
      inject: { project_id },
      execute: async ({ project_id, region, size }) => {
        const replica = await networkSecurity.setupReadReplica(project_id, {
          region,
          size,
        });
        return source`
          Read replica setup initiated:
          ${JSON.stringify(replica, null, 2)}
        `;
      },
    }),

    remove_read_replica: injectableTool({
      description:
        'Removes a read replica from a project.',
      annotations: {
        title: 'Remove read replica',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        replica_id: z
          .string()
          .describe('ID of the read replica to remove'),
      }),
      inject: { project_id },
      execute: async ({ project_id, replica_id }) => {
        await networkSecurity.removeReadReplica(project_id, replica_id);
        return source`
          Read replica '${replica_id}' has been removed.
        `;
      },
    }),
  };

  return networkSecurityTools;
}