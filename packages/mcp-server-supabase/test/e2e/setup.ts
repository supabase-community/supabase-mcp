import { setupServer, SetupServerApi } from 'msw/node';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import {
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../mocks.js';

let server: SetupServerApi | null = null;

beforeAll(() => {
  server = setupServer(...mockManagementApi);
  server.listen({ onUnhandledRequest: 'bypass' });
});

beforeEach(() => {
  mockOrgs.clear();
  mockProjects.clear();
  mockBranches.clear();
});

afterAll(() => {
  server?.close();
});
