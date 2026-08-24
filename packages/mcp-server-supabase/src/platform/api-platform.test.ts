import type { SetupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ACCESS_TOKEN,
  API_URL,
  createOrganization,
  createProject,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MOCK_BRANCH_CREATION_RATE,
  MOCK_PROJECT_CREATION_RATE,
  queuedBranchCreationRates,
  queuedProjectCreationRates,
  setupMockApis,
} from '../../test/mocks.js';
import { createSupabaseApiPlatform } from './api-platform.js';

/**
 * The creation-rate reads go through the real adapter and the real v2 paths.
 * Everywhere else these rates are stubbed at the platform seam, so this is the
 * only place the request paths and the `data.attributes` envelope are
 * exercised.
 */

let mockServer: SetupServer | undefined;

beforeEach(() => {
  mockServer = setupMockApis();
});

afterEach(() => {
  mockServer?.close();
});

async function apiPlatform() {
  const platform = createSupabaseApiPlatform({
    accessToken: ACCESS_TOKEN,
    apiUrl: API_URL,
  });

  // The mock API asserts the user agent on every request, which the platform
  // sets when the server initializes.
  await platform.init?.({
    clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    clientCapabilities: {},
  });

  return platform;
}

async function billableOrganization() {
  const org = await createOrganization({
    name: 'Paid Org',
    plan: 'pro',
    allowed_release_channels: ['ga'],
  });
  // A paid plan absorbs its first active project, so the next one is billable.
  await createProject({
    name: 'Existing',
    region: 'us-east-1',
    organization_id: org.id,
  });
  return org;
}

describe('project creation rate', () => {
  test('unwraps the response envelope down to the rate itself', async () => {
    const org = await billableOrganization();
    const platform = await apiPlatform();

    const rate = await platform.account?.getProjectCreationRate(org.id);

    // Exactly the rate: the applicability context the endpoint also returns
    // (organization slug, plan, active project count) stays out of the
    // package, because nothing here decides pricing.
    expect(rate).toStrictEqual(MOCK_PROJECT_CREATION_RATE);
  });

  test('returns a zero amount as the authoritative rate it is', async () => {
    const org = await createOrganization({
      name: 'Free Org',
      plan: 'free',
      allowed_release_channels: ['ga'],
    });
    const platform = await apiPlatform();

    expect(
      await platform.account?.getProjectCreationRate(org.id)
    ).toStrictEqual({ ...MOCK_PROJECT_CREATION_RATE, amount: 0 });
  });

  test('carries the currency and recurrence the endpoint reports', async () => {
    const org = await billableOrganization();
    const platform = await apiPlatform();
    // Nothing about the mapping is hard-coded, so a rate in another currency
    // at another interval arrives unchanged.
    queuedProjectCreationRates.push({
      amount: 0.5,
      currency: 'EUR',
      recurrence: 'hourly',
    });

    expect(
      await platform.account?.getProjectCreationRate(org.id)
    ).toStrictEqual({ amount: 0.5, currency: 'EUR', recurrence: 'hourly' });
  });

  test('a UUID-shaped identifier is not an organization slug', async () => {
    const platform = await apiPlatform();

    // The v2 route resolves a slug and nothing else. A client's
    // `organization_id` already holds a slug, because v1 keeps `id` as a
    // deprecated alias of it, so a UUID reaching here is a caller bug and
    // surfaces as the platform's own not-found error rather than a rate.
    await expect(
      platform.account?.getProjectCreationRate(
        '3f1c9a44-6f2e-4d3b-9c8a-1e5b7d0f2a61'
      )
    ).rejects.toThrowError('Organization not found');
  });
});

describe('branch creation rate', () => {
  test('reads the rate for the parent project, hourly', async () => {
    const org = await billableOrganization();
    const project = await createProject({
      name: 'Parent',
      region: 'us-east-1',
      organization_id: org.id,
    });
    const platform = await apiPlatform();

    expect(
      await platform.branching?.getBranchCreationRate(project.id)
    ).toStrictEqual(MOCK_BRANCH_CREATION_RATE);
  });

  test('returns a zero amount as the authoritative rate it is', async () => {
    const org = await billableOrganization();
    const project = await createProject({
      name: 'Parent',
      region: 'us-east-1',
      organization_id: org.id,
    });
    const platform = await apiPlatform();
    queuedBranchCreationRates.push({
      ...MOCK_BRANCH_CREATION_RATE,
      amount: 0,
    });

    expect(
      await platform.branching?.getBranchCreationRate(project.id)
    ).toStrictEqual({ ...MOCK_BRANCH_CREATION_RATE, amount: 0 });
  });
});
