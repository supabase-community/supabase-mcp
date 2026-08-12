export type ProjectCost = {
  amount: number;
  recurrence: 'monthly';
};

export type MockProject = {
  id: string;
  name: string;
  organization_id: string;
  cost: ProjectCost;
};

export type CreateProjectParams = Omit<MockProject, 'id'>;

export interface Registry {
  createProject(params: CreateProjectParams): MockProject;
  list(): MockProject[];
  countByName(name: string): number;
}
