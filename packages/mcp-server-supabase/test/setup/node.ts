import { setupServer } from 'msw/node';
import { afterEach, beforeEach, inject } from 'vitest';
import {
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../mocks.js';

const server = setupServer(...mockManagementApi);

beforeEach(async () => {
  mockOrgs.clear();
  mockProjects.clear();
  mockBranches.clear();

  server.listen({
    onUnhandledRequest: inject('msw-on-unhandled-request'),
  });
});

afterEach(async () => {
  server.close();
});
