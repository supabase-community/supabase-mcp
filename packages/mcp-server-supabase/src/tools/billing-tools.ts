import { z } from 'zod';
import type { BillingOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface BillingToolsOptions {
  billing: BillingOperations;
  projectId?: string;
}

export function getBillingTools({ billing, projectId }: BillingToolsOptions) {
  const project_id = projectId;

  const billingTools = {
    get_billing_subscription: injectableTool({
      description:
        'Retrieves the current billing subscription details for a project.',
      annotations: {
        title: 'Get billing subscription',
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
        const subscription = await billing.getBillingSubscription(project_id);
        return source`
          Billing Subscription:
          ${JSON.stringify(subscription, null, 2)}
        `;
      },
    }),

    get_billing_usage: injectableTool({
      description:
        'Retrieves current billing period usage and costs for a project.',
      annotations: {
        title: 'Get billing usage',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        billing_period: z
          .string()
          .optional()
          .describe('Billing period (YYYY-MM format)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, billing_period }) => {
        const usage = await billing.getBillingUsage(project_id, billing_period);
        return source`
          Billing Usage:
          ${JSON.stringify(usage, null, 2)}
        `;
      },
    }),

    list_billing_addons: injectableTool({
      description: 'Lists all billing add-ons configured for a project.',
      annotations: {
        title: 'List billing add-ons',
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
        const addons = await billing.listBillingAddons(project_id);
        return source`
          Billing Add-ons:
          ${JSON.stringify(addons, null, 2)}
        `;
      },
    }),

    add_billing_addon: injectableTool({
      description:
        'Adds a billing add-on to a project (e.g., compute, storage, support).',
      annotations: {
        title: 'Add billing add-on',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        addon_type: z
          .enum([
            'compute',
            'storage',
            'bandwidth',
            'support',
            'ipv4',
            'custom_domain',
            'pitr',
          ])
          .describe('Type of add-on to add'),
        variant: z
          .string()
          .optional()
          .describe('Variant of the add-on (e.g., small, medium, large)'),
        quantity: z.number().optional().describe('Quantity of the add-on'),
      }),
      inject: { project_id },
      execute: async ({ project_id, addon_type, variant, quantity }) => {
        const addon = await billing.addBillingAddon(project_id, {
          type: addon_type,
          variant,
          quantity,
        });
        return source`
          Billing add-on added:
          ${JSON.stringify(addon, null, 2)}
        `;
      },
    }),

    update_billing_addon: injectableTool({
      description: 'Updates configuration for an existing billing add-on.',
      annotations: {
        title: 'Update billing add-on',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        addon_type: z.string().describe('Type of add-on to update'),
        variant: z.string().optional().describe('New variant'),
        quantity: z.number().optional().describe('New quantity'),
      }),
      inject: { project_id },
      execute: async ({ project_id, addon_type, variant, quantity }) => {
        const updated = await billing.updateBillingAddon(
          project_id,
          addon_type,
          {
            variant,
            quantity,
          }
        );
        return source`
          Billing add-on updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    remove_billing_addon: injectableTool({
      description: 'Removes a billing add-on from a project.',
      annotations: {
        title: 'Remove billing add-on',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        addon_type: z.string().describe('Type of add-on to remove'),
      }),
      inject: { project_id },
      execute: async ({ project_id, addon_type }) => {
        await billing.removeBillingAddon(project_id, addon_type);
        return source`
          Billing add-on '${addon_type}' has been removed.
        `;
      },
    }),

    get_spend_cap: injectableTool({
      description: 'Retrieves the spend cap configuration for a project.',
      annotations: {
        title: 'Get spend cap',
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
        const spendCap = await billing.getSpendCap(project_id);
        return source`
          Spend Cap Configuration:
          ${JSON.stringify(spendCap, null, 2)}
        `;
      },
    }),

    update_spend_cap: injectableTool({
      description:
        'Updates the spend cap limit for a project to control costs.',
      annotations: {
        title: 'Update spend cap',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        enabled: z.boolean().describe('Whether to enable spend cap'),
        monthly_limit: z
          .number()
          .optional()
          .describe('Monthly spending limit in USD'),
        action: z
          .enum(['pause', 'notify', 'throttle'])
          .optional()
          .describe('Action to take when limit is reached'),
      }),
      inject: { project_id },
      execute: async ({ project_id, enabled, monthly_limit, action }) => {
        const updated = await billing.updateSpendCap(project_id, {
          enabled,
          monthly_limit,
          action,
        });
        return source`
          Spend cap updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    get_invoices: injectableTool({
      description: 'Retrieves billing invoices for a project or organization.',
      annotations: {
        title: 'Get invoices',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string().optional(),
        organization_id: z.string().optional(),
        limit: z.number().optional().describe('Number of invoices to retrieve'),
        status: z
          .enum(['paid', 'pending', 'overdue', 'draft'])
          .optional()
          .describe('Filter by invoice status'),
      }),
      inject: { project_id },
      execute: async ({ project_id, organization_id, limit, status }) => {
        const invoices = await billing.getInvoices({
          project_id,
          organization_id,
          limit,
          status,
        });
        return source`
          Invoices:
          ${JSON.stringify(invoices, null, 2)}
        `;
      },
    }),

    get_billing_credits: injectableTool({
      description:
        'Retrieves available billing credits for a project or organization.',
      annotations: {
        title: 'Get billing credits',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string().optional(),
        organization_id: z.string().optional(),
      }),
      inject: { project_id },
      execute: async ({ project_id, organization_id }) => {
        const credits = await billing.getBillingCredits({
          project_id,
          organization_id,
        });
        return source`
          Billing Credits:
          ${JSON.stringify(credits, null, 2)}
        `;
      },
    }),

    estimate_costs: injectableTool({
      description: 'Estimates costs for a project based on projected usage.',
      annotations: {
        title: 'Estimate costs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        usage_estimates: z
          .object({
            database_size_gb: z.number().optional(),
            storage_gb: z.number().optional(),
            bandwidth_gb: z.number().optional(),
            mau: z.number().optional().describe('Monthly active users'),
            function_invocations: z.number().optional(),
            realtime_messages: z.number().optional(),
          })
          .describe('Estimated usage metrics'),
        period: z
          .enum(['monthly', 'annual'])
          .optional()
          .describe('Estimation period'),
      }),
      inject: { project_id },
      execute: async ({ project_id, usage_estimates, period }) => {
        const estimate = await billing.estimateCosts(
          project_id,
          usage_estimates,
          period
        );
        return source`
          Cost Estimate:
          ${JSON.stringify(estimate, null, 2)}
        `;
      },
    }),
  };

  return billingTools;
}
