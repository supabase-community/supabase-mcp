import { setupWorker } from 'msw/browser';
import { afterEach, beforeEach, inject } from 'vitest';
import {
  mockBranches,
  mockManagementApi,
  mockOrgs,
  mockProjects,
} from '../mocks.js';

const worker = setupWorker(...mockManagementApi);

beforeEach(async () => {
  mockOrgs.clear();
  mockProjects.clear();
  mockBranches.clear();

  await worker.start({
    onUnhandledRequest: inject('msw-on-unhandled-request'),
    quiet: true,
  });
});

afterEach(async () => {
  worker.stop();
});
