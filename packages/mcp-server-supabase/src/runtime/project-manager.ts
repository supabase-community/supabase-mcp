import type { ClientContext } from '../auth.js';
import type { SupabasePlatform } from '../platform/index.js';
import type { ProjectContext } from '../config/project-context.js';

export interface ProjectInfo {
  id: string;
  name: string;
  organization_id: string;
  region: string;
  created_at: string;
  status: string;
  plan?: string;
}

export interface ProjectSwitchResult {
  success: boolean;
  previousProject?: string;
  newProject: string;
  message: string;
  claudeCLIMessage?: string;
  warnings?: string[];
}

export interface ProjectListResult {
  projects: ProjectInfo[];
  currentProject?: string;
  claudeCLIFormatted?: string;
  hasMultipleProjects: boolean;
}

class ProjectManager {
  private currentProjectRef?: string;
  private clientContext?: ClientContext;
  private platform: SupabasePlatform;
  private projectsCache?: ProjectInfo[];
  private lastFetchTime?: Date;
  private projectContext?: ProjectContext;
  private autoDetectedProject?: string;

  constructor(
    platform: SupabasePlatform,
    initialProjectRef?: string,
    clientContext?: ClientContext,
    projectContext?: ProjectContext
  ) {
    this.platform = platform;
    this.currentProjectRef = initialProjectRef;
    this.clientContext = clientContext;
    this.projectContext = projectContext;

    // If project context has a project ID and no explicit project was provided,
    // use the auto-detected project
    if (projectContext?.credentials.projectId && !initialProjectRef) {
      this.autoDetectedProject = projectContext.credentials.projectId;
      this.currentProjectRef = this.autoDetectedProject;

      if (clientContext?.isClaudeCLI) {
        console.log(
          `🎯 Auto-selected project from current directory: ${this.autoDetectedProject}`
        );
      }
    }
  }

  getCurrentProject(): string | undefined {
    return this.currentProjectRef;
  }

  async listAvailableProjects(
    forceRefresh: boolean = false
  ): Promise<ProjectListResult> {
    // Use cache if available and not expired (5 minutes)
    if (!forceRefresh && this.projectsCache && this.lastFetchTime) {
      const ageMinutes =
        (Date.now() - this.lastFetchTime.getTime()) / (1000 * 60);
      if (ageMinutes < 5) {
        return this.formatProjectList(this.projectsCache);
      }
    }

    try {
      // Fetch projects from the platform
      if (!this.platform.account) {
        throw new Error('Account operations not available');
      }
      const response = await this.platform.account.listProjects();
      const projects: ProjectInfo[] = response.map((project: any) => ({
        id: project.id,
        name: project.name,
        organization_id: project.organization_id,
        region: project.region,
        created_at: project.created_at,
        status: project.status,
        plan: project.plan,
      }));

      // Update cache
      this.projectsCache = projects;
      this.lastFetchTime = new Date();

      return this.formatProjectList(projects);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error fetching projects';

      if (this.clientContext?.isClaudeCLI) {
        throw new Error(
          `Claude CLI: Failed to fetch projects - ${errorMessage}`
        );
      }

      throw new Error(`Failed to fetch projects: ${errorMessage}`);
    }
  }

  private formatProjectList(projects: ProjectInfo[]): ProjectListResult {
    const hasMultipleProjects = projects.length > 1;

    let claudeCLIFormatted: string | undefined;

    if (this.clientContext?.isClaudeCLI) {
      claudeCLIFormatted = this.formatProjectsForClaudeCLI(projects);
    }

    return {
      projects,
      currentProject: this.currentProjectRef,
      claudeCLIFormatted,
      hasMultipleProjects,
    };
  }

  private formatProjectsForClaudeCLI(projects: ProjectInfo[]): string {
    if (projects.length === 0) {
      return '📋 Claude CLI: No projects found in your Supabase account.';
    }

    let formatted = `📋 Claude CLI: Found ${projects.length} project${projects.length > 1 ? 's' : ''}\n\n`;

    projects.forEach((project, index) => {
      const isCurrent = project.id === this.currentProjectRef;
      const indicator = isCurrent ? '👉 ' : '   ';
      const status =
        project.status === 'ACTIVE_HEALTHY'
          ? '🟢'
          : project.status === 'PAUSED'
            ? '🟡'
            : '🔴';

      formatted += `${indicator}${index + 1}. ${status} ${project.name}\n`;
      formatted += `      ID: ${project.id}\n`;
      formatted += `      Region: ${project.region}\n`;
      formatted += `      Status: ${project.status}\n`;
      if (project.plan) {
        formatted += `      Plan: ${project.plan}\n`;
      }
      if (isCurrent) {
        formatted += `      🎯 Currently selected\n`;
      }
      formatted += '\n';
    });

    if (projects.length > 1) {
      formatted += '💡 Use switch_project tool to change the active project.';
    }

    return formatted;
  }

  async switchToProject(projectRef: string): Promise<ProjectSwitchResult> {
    const previousProject = this.currentProjectRef;

    try {
      // Validate project exists and is accessible
      await this.validateProjectAccess(projectRef);

      // Update current project
      this.currentProjectRef = projectRef;

      const result: ProjectSwitchResult = {
        success: true,
        previousProject,
        newProject: projectRef,
        message: `Successfully switched to project ${projectRef}`,
      };

      // Add warnings if switching away from auto-detected project
      const warnings: string[] = [];
      if (this.autoDetectedProject && projectRef !== this.autoDetectedProject) {
        warnings.push(
          `Note: Switching away from auto-detected project ${this.autoDetectedProject}`
        );
        warnings.push('Current directory suggests a different project context');
      }

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      // Add Claude CLI specific messaging
      if (this.clientContext?.isClaudeCLI) {
        const projectInfo = await this.getProjectInfo(projectRef);
        result.claudeCLIMessage =
          `🎯 Claude CLI: Switched to project "${projectInfo?.name || projectRef}"\n` +
          `   • Project ID: ${projectRef}\n` +
          `   • Status: ${projectInfo?.status || 'Unknown'}\n` +
          `   • All subsequent operations will use this project`;

        if (previousProject) {
          result.claudeCLIMessage += `\n   • Previous project: ${previousProject}`;
        }

        if (
          this.autoDetectedProject &&
          projectRef !== this.autoDetectedProject
        ) {
          result.claudeCLIMessage += `\n   ⚠️  Note: Overriding auto-detected project ${this.autoDetectedProject}`;
        }
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        previousProject,
        newProject: projectRef,
        message: `Failed to switch to project ${projectRef}: ${errorMessage}`,
        claudeCLIMessage: this.clientContext?.isClaudeCLI
          ? `❌ Claude CLI: Could not switch to project ${projectRef} - ${errorMessage}`
          : undefined,
      };
    }
  }

  async validateProjectAccess(projectRef: string): Promise<boolean> {
    try {
      // Try to get project details to validate access
      if (!this.platform.account) {
        throw new Error('Account operations not available');
      }
      await this.platform.account.getProject(projectRef);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Access validation failed';

      if (this.clientContext?.isClaudeCLI) {
        throw new Error(
          `Claude CLI: Cannot access project ${projectRef} - ${errorMessage}`
        );
      }

      throw new Error(`Cannot access project ${projectRef}: ${errorMessage}`);
    }
  }

  async getProjectInfo(projectRef: string): Promise<ProjectInfo | null> {
    try {
      if (!this.platform.account) {
        throw new Error('Account operations not available');
      }
      const project = await this.platform.account.getProject(projectRef);
      return {
        id: project.id,
        name: project.name,
        organization_id: project.organization_id,
        region: project.region,
        created_at: project.created_at,
        status: project.status,
      };
    } catch (error) {
      if (this.clientContext?.isClaudeCLI) {
        console.warn(
          `Claude CLI: Could not fetch details for project ${projectRef}`
        );
      }
      return null;
    }
  }

  async switchProjectInteractiveClaudeCLI(
    projectIdentifier?: string
  ): Promise<ProjectSwitchResult> {
    if (!this.clientContext?.isClaudeCLI) {
      throw new Error(
        'Interactive project switching is only available for Claude CLI'
      );
    }

    const projectList = await this.listAvailableProjects();

    if (projectList.projects.length === 0) {
      return {
        success: false,
        newProject: '',
        message: 'No projects available in your Supabase account',
        claudeCLIMessage:
          '📋 Claude CLI: No projects found. Create a project at https://supabase.com/dashboard',
      };
    }

    if (projectList.projects.length === 1) {
      const singleProject = projectList.projects[0];
      if (!singleProject) {
        return {
          success: false,
          newProject: '',
          message: 'Project data corrupted',
          claudeCLIMessage: '⚠️ Claude CLI: Project data corrupted',
        };
      }
      if (singleProject.id === this.currentProjectRef) {
        return {
          success: true,
          newProject: singleProject.id,
          message: 'Already using the only available project',
          claudeCLIMessage: `🎯 Claude CLI: Already using your only project "${singleProject.name}"`,
        };
      } else {
        return await this.switchToProject(singleProject.id);
      }
    }

    // Multiple projects available
    if (!projectIdentifier) {
      return {
        success: false,
        newProject: '',
        message:
          'Multiple projects available. Please specify project ID or name.',
        claudeCLIMessage:
          projectList.claudeCLIFormatted +
          '\n\n💡 Call switch_project again with project_identifier parameter',
      };
    }

    // Find project by ID or name
    const targetProject = projectList.projects.find(
      (p) =>
        p.id === projectIdentifier ||
        p.name.toLowerCase().includes(projectIdentifier.toLowerCase())
    );

    if (!targetProject) {
      const availableIds = projectList.projects
        .map((p) => `"${p.id}"`)
        .join(', ');
      const availableNames = projectList.projects
        .map((p) => `"${p.name}"`)
        .join(', ');

      return {
        success: false,
        newProject: projectIdentifier,
        message: `Project "${projectIdentifier}" not found`,
        claudeCLIMessage:
          `❌ Claude CLI: Project "${projectIdentifier}" not found.\n\n` +
          `Available project IDs: ${availableIds}\n` +
          `Available project names: ${availableNames}\n\n` +
          projectList.claudeCLIFormatted,
      };
    }

    return await this.switchToProject(targetProject.id);
  }

  getProjectSwitchGuidance(): string[] {
    if (!this.clientContext?.isClaudeCLI) {
      return [
        'Use switch_project tool with project ID to change active project',
      ];
    }

    return [
      '🎯 Claude CLI Project Switching:',
      '1. Use switch_project tool to see available projects',
      '2. Specify project_identifier (ID or name) to switch',
      '3. Project switching affects all subsequent operations',
      '4. Current project is shown with 👉 indicator',
      '',
    ];
  }
}

// Global project manager instance
let projectManagerInstance: ProjectManager | null = null;

export function initializeProjectManager(
  platform: SupabasePlatform,
  initialProjectRef?: string,
  clientContext?: ClientContext,
  projectContext?: ProjectContext
): void {
  projectManagerInstance = new ProjectManager(
    platform,
    initialProjectRef,
    clientContext,
    projectContext
  );
}

export function getProjectManager(): ProjectManager {
  if (!projectManagerInstance) {
    throw new Error(
      'Project manager not initialized. Call initializeProjectManager() first.'
    );
  }
  return projectManagerInstance;
}

export function resetProjectManager(): void {
  projectManagerInstance = null;
}

// Convenience functions
export async function listProjectsForClaudeCLI(): Promise<ProjectListResult> {
  const manager = getProjectManager();
  return await manager.listAvailableProjects();
}

export async function switchProjectInteractiveClaudeCLI(
  projectIdentifier?: string
): Promise<ProjectSwitchResult> {
  const manager = getProjectManager();
  return await manager.switchProjectInteractiveClaudeCLI(projectIdentifier);
}

export function getCurrentProjectRef(): string | undefined {
  const manager = getProjectManager();
  return manager.getCurrentProject();
}

export async function validateProjectAccessForClaudeCLI(
  projectRef: string
): Promise<boolean> {
  const manager = getProjectManager();
  return await manager.validateProjectAccess(projectRef);
}
