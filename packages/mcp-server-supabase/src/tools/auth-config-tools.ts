import { z } from 'zod';
import type { AuthConfigOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { source } from 'common-tags';

export interface AuthConfigToolsOptions {
  authConfig: AuthConfigOperations;
  projectId?: string;
}

export function getAuthConfigTools({
  authConfig,
  projectId,
}: AuthConfigToolsOptions) {
  const project_id = projectId;

  const authConfigTools = {
    get_auth_config: injectableTool({
      description:
        'Retrieves the authentication configuration for a project including providers, settings, and policies.',
      annotations: {
        title: 'Get auth configuration',
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
        const config = await authConfig.getAuthConfig(project_id);
        return source`
          Authentication Configuration:
          ${JSON.stringify(config, null, 2)}
        `;
      },
    }),

    update_auth_config: injectableTool({
      description:
        'Updates the authentication configuration for a project including settings like MFA, password requirements, and session management.',
      annotations: {
        title: 'Update auth configuration',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        config: z
          .object({
            enable_signup: z.boolean().optional(),
            enable_anonymous_sign_ins: z.boolean().optional(),
            enable_manual_linking: z.boolean().optional(),
            disable_email_confirmation: z.boolean().optional(),
            minimum_password_length: z.number().optional(),
            password_required_characters: z
              .array(z.enum(['lower_case', 'upper_case', 'numbers', 'symbols']))
              .optional(),
            mfa_max_enrolled_factors: z.number().optional(),
            sessions_per_user: z.number().optional(),
            jwt_expiry: z.number().optional(),
            refresh_token_rotation_enabled: z.boolean().optional(),
            security_refresh_token_reuse_interval: z.number().optional(),
            security_captcha_enabled: z.boolean().optional(),
            security_captcha_provider: z.enum(['hcaptcha', 'turnstile']).optional(),
            security_captcha_secret: z.string().optional(),
            external_email_enabled: z.boolean().optional(),
            external_phone_enabled: z.boolean().optional(),
            external_apple_enabled: z.boolean().optional(),
            external_azure_enabled: z.boolean().optional(),
            external_bitbucket_enabled: z.boolean().optional(),
            external_discord_enabled: z.boolean().optional(),
            external_facebook_enabled: z.boolean().optional(),
            external_figma_enabled: z.boolean().optional(),
            external_github_enabled: z.boolean().optional(),
            external_gitlab_enabled: z.boolean().optional(),
            external_google_enabled: z.boolean().optional(),
            external_kakao_enabled: z.boolean().optional(),
            external_keycloak_enabled: z.boolean().optional(),
            external_linkedin_enabled: z.boolean().optional(),
            external_linkedin_oidc_enabled: z.boolean().optional(),
            external_notion_enabled: z.boolean().optional(),
            external_slack_enabled: z.boolean().optional(),
            external_slack_oidc_enabled: z.boolean().optional(),
            external_spotify_enabled: z.boolean().optional(),
            external_twitch_enabled: z.boolean().optional(),
            external_twitter_enabled: z.boolean().optional(),
            external_workos_enabled: z.boolean().optional(),
            external_zoom_enabled: z.boolean().optional(),
            smtp_host: z.string().optional(),
            smtp_port: z.number().optional(),
            smtp_user: z.string().optional(),
            smtp_pass: z.string().optional(),
            smtp_sender_name: z.string().optional(),
            smtp_admin_email: z.string().optional(),
            sms_provider: z.enum(['twilio', 'twilio_verify', 'messagebird', 'textlocal', 'vonage']).optional(),
            sms_twilio_account_sid: z.string().optional(),
            sms_twilio_auth_token: z.string().optional(),
            sms_twilio_message_service_sid: z.string().optional(),
            sms_twilio_verify_account_sid: z.string().optional(),
            sms_twilio_verify_auth_token: z.string().optional(),
            sms_twilio_verify_message_service_sid: z.string().optional(),
            sms_messagebird_access_key: z.string().optional(),
            sms_messagebird_originator: z.string().optional(),
            sms_textlocal_api_key: z.string().optional(),
            sms_textlocal_sender: z.string().optional(),
            sms_vonage_api_key: z.string().optional(),
            sms_vonage_api_secret: z.string().optional(),
            sms_vonage_from: z.string().optional(),
          })
          .describe('Authentication configuration to update'),
      }),
      inject: { project_id },
      execute: async ({ project_id, config }) => {
        const updated = await authConfig.updateAuthConfig(project_id, config);
        return source`
          Authentication configuration updated successfully:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    list_third_party_auth: injectableTool({
      description:
        'Lists all third-party authentication providers configured for a project.',
      annotations: {
        title: 'List third-party auth providers',
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
        const providers = await authConfig.listThirdPartyAuth(project_id);
        return source`
          Third-Party Authentication Providers:
          ${JSON.stringify(providers, null, 2)}
        `;
      },
    }),

    get_third_party_auth: injectableTool({
      description:
        'Gets configuration details for a specific third-party authentication provider.',
      annotations: {
        title: 'Get third-party auth provider',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider_id: z
          .string()
          .describe('The third-party provider ID (e.g., google, github, etc.)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider_id }) => {
        const provider = await authConfig.getThirdPartyAuth(project_id, provider_id);
        return source`
          Third-Party Provider Configuration (${provider_id}):
          ${JSON.stringify(provider, null, 2)}
        `;
      },
    }),

    create_third_party_auth: injectableTool({
      description:
        'Configures a new third-party authentication provider for a project.',
      annotations: {
        title: 'Create third-party auth provider',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider: z
          .object({
            provider: z.enum([
              'apple', 'azure', 'bitbucket', 'discord', 'facebook',
              'figma', 'github', 'gitlab', 'google', 'kakao',
              'keycloak', 'linkedin', 'linkedin_oidc', 'notion',
              'slack', 'slack_oidc', 'spotify', 'twitch', 'twitter',
              'workos', 'zoom'
            ]),
            enabled: z.boolean(),
            client_id: z.string(),
            client_secret: z.string(),
            redirect_uri: z.string().optional(),
            url: z.string().optional().describe('For custom providers like Keycloak'),
            skip_nonce_check: z.boolean().optional(),
          })
          .describe('Third-party provider configuration'),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider }) => {
        const created = await authConfig.createThirdPartyAuth(project_id, provider);
        return source`
          Third-party authentication provider created:
          ${JSON.stringify(created, null, 2)}
        `;
      },
    }),

    update_third_party_auth: injectableTool({
      description:
        'Updates configuration for an existing third-party authentication provider.',
      annotations: {
        title: 'Update third-party auth provider',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider_id: z.string(),
        config: z
          .object({
            enabled: z.boolean().optional(),
            client_id: z.string().optional(),
            client_secret: z.string().optional(),
            redirect_uri: z.string().optional(),
            url: z.string().optional(),
            skip_nonce_check: z.boolean().optional(),
          })
          .describe('Provider configuration to update'),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider_id, config }) => {
        const updated = await authConfig.updateThirdPartyAuth(project_id, provider_id, config);
        return source`
          Third-party provider updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    delete_third_party_auth: injectableTool({
      description:
        'Removes a third-party authentication provider from a project.',
      annotations: {
        title: 'Delete third-party auth provider',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider_id }) => {
        await authConfig.deleteThirdPartyAuth(project_id, provider_id);
        return source`
          Third-party authentication provider '${provider_id}' has been removed.
        `;
      },
    }),

    list_sso_providers: injectableTool({
      description:
        'Lists all SSO (Single Sign-On) providers configured for a project.',
      annotations: {
        title: 'List SSO providers',
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
        const providers = await authConfig.listSsoProviders(project_id);
        return source`
          SSO Providers:
          ${JSON.stringify(providers, null, 2)}
        `;
      },
    }),

    create_sso_provider: injectableTool({
      description:
        'Configures a new SSO provider for enterprise authentication.',
      annotations: {
        title: 'Create SSO provider',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider: z
          .object({
            type: z.enum(['saml', 'oidc']),
            metadata_url: z.string().optional(),
            metadata_xml: z.string().optional(),
            attribute_mapping: z.record(z.string()).optional(),
            domains: z.array(z.string()),
          })
          .describe('SSO provider configuration'),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider }) => {
        const created = await authConfig.createSsoProvider(project_id, provider);
        return source`
          SSO provider created:
          ${JSON.stringify(created, null, 2)}
        `;
      },
    }),

    update_sso_provider: injectableTool({
      description:
        'Updates configuration for an existing SSO provider.',
      annotations: {
        title: 'Update SSO provider',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider_id: z.string(),
        config: z
          .object({
            metadata_url: z.string().optional(),
            metadata_xml: z.string().optional(),
            attribute_mapping: z.record(z.string()).optional(),
            domains: z.array(z.string()).optional(),
          })
          .describe('SSO provider configuration to update'),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider_id, config }) => {
        const updated = await authConfig.updateSsoProvider(project_id, provider_id, config);
        return source`
          SSO provider updated:
          ${JSON.stringify(updated, null, 2)}
        `;
      },
    }),

    delete_sso_provider: injectableTool({
      description:
        'Removes an SSO provider from a project.',
      annotations: {
        title: 'Delete SSO provider',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        provider_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id, provider_id }) => {
        await authConfig.deleteSsoProvider(project_id, provider_id);
        return source`
          SSO provider '${provider_id}' has been removed.
        `;
      },
    }),

    rotate_jwt_secret: injectableTool({
      description:
        'Rotates the JWT signing secret for a project. This will invalidate all existing tokens.',
      annotations: {
        title: 'Rotate JWT secret',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const result = await authConfig.rotateJwtSecret(project_id);
        return source`
          JWT secret rotated successfully:
          ${JSON.stringify(result, null, 2)}

          ⚠️ Warning: All existing JWT tokens are now invalid.
        `;
      },
    }),

    get_signing_keys: injectableTool({
      description:
        'Retrieves JWT signing keys for a project.',
      annotations: {
        title: 'Get JWT signing keys',
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
        const keys = await authConfig.getSigningKeys(project_id);
        return source`
          JWT Signing Keys:
          ${JSON.stringify(keys, null, 2)}
        `;
      },
    }),
  };

  return authConfigTools;
}