import { randomUUID } from 'node:crypto';

import type { CreateProjectParams, MockProject, Registry } from './types.js';

export function createRegistry(): Registry {
  const projects: MockProject[] = [];

  return {
    createProject(params) {
      const project = { id: randomUUID(), ...params };
      projects.push(project);
      return project;
    },
    list() {
      return projects.map((project) => ({ ...project }));
    },
    countByName(name) {
      return projects.filter((project) => project.name === name).length;
    },
  };
}

export type { MockProject, Registry } from './types.js';
