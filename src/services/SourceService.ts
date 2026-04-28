/**
 * Source Service — reads projects, tasks, teams, dependencies, assignments from source environment
 * Uses DataverseClient for all Web API calls
 */

import { DataverseClient } from '../clients/DataverseClient';
import {
  ServiceResult,
  SourceProject,
  SourceTask,
  SourceTeamMember,
  SourceDependency,
  SourceAssignment,
  SourceBucket,
  SourceSprint,
  SourceProjectData,
  EntityCounts,
} from '../types/migration';

export class SourceService {
  private client: DataverseClient;

  constructor(client: DataverseClient) {
    this.client = client;
  }

  /**
   * Fetch all active projects from source environment
   */
  async getProjects(): Promise<ServiceResult<SourceProject[]>> {
    console.log('SourceService: Starting getProjects()');
    console.time('SourceService.getProjects');

    // Fetch without $select to get all available columns — avoids schema mismatches
    const result = await this.client.getAll<SourceProject>(
      'msdyn_projects',
      undefined, // No $select — return all columns
      'statecode eq 0' // Active only
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} projects`);
    }
    console.timeEnd('SourceService.getProjects');
    return result;
  }

  /**
   * Fetch all tasks for a specific project
   */
  async getProjectTasks(projectId: string): Promise<ServiceResult<SourceTask[]>> {
    console.log(`SourceService: Starting getProjectTasks(${projectId})`);
    console.time(`SourceService.getProjectTasks(${projectId})`);

    const result = await this.client.getAll<SourceTask>(
      'msdyn_projecttasks',
      undefined,
      `_msdyn_project_value eq ${projectId} and statecode eq 0`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} tasks for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectTasks(${projectId})`);
    return result;
  }

  /**
   * Fetch all team members for a specific project
   */
  async getProjectTeamMembers(projectId: string): Promise<ServiceResult<SourceTeamMember[]>> {
    console.log(`SourceService: Starting getProjectTeamMembers(${projectId})`);
    console.time(`SourceService.getProjectTeamMembers(${projectId})`);

    const result = await this.client.getAll<SourceTeamMember>(
      'msdyn_projectteams',
      undefined,
      `_msdyn_project_value eq ${projectId} and statecode eq 0`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} team members for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectTeamMembers(${projectId})`);
    return result;
  }

  /**
   * Fetch all task dependencies for a specific project
   */
  async getProjectDependencies(projectId: string): Promise<ServiceResult<SourceDependency[]>> {
    console.log(`SourceService: Starting getProjectDependencies(${projectId})`);
    console.time(`SourceService.getProjectDependencies(${projectId})`);

    const result = await this.client.getAll<SourceDependency>(
      'msdyn_projecttaskdependencies',
      undefined,
      `_msdyn_project_value eq ${projectId}`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} dependencies for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectDependencies(${projectId})`);
    return result;
  }

  /**
   * Fetch all resource assignments for a specific project
   */
  async getProjectAssignments(projectId: string): Promise<ServiceResult<SourceAssignment[]>> {
    console.log(`SourceService: Starting getProjectAssignments(${projectId})`);
    console.time(`SourceService.getProjectAssignments(${projectId})`);

    const result = await this.client.getAll<SourceAssignment>(
      'msdyn_resourceassignments',
      undefined,
      `_msdyn_projectid_value eq ${projectId} and statecode eq 0`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} assignments for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectAssignments(${projectId})`);
    return result;
  }

  /**
   * Fetch all buckets for a specific project
   */
  async getProjectBuckets(projectId: string): Promise<ServiceResult<SourceBucket[]>> {
    console.log(`SourceService: Starting getProjectBuckets(${projectId})`);
    console.time(`SourceService.getProjectBuckets(${projectId})`);

    const result = await this.client.getAll<SourceBucket>(
      'msdyn_projectbuckets',
      undefined,
      `_msdyn_project_value eq ${projectId}`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} buckets for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectBuckets(${projectId})`);
    return result;
  }

  /**
   * Fetch all sprints for a specific project
   */
  async getProjectSprints(projectId: string): Promise<ServiceResult<SourceSprint[]>> {
    console.log(`SourceService: Starting getProjectSprints(${projectId})`);
    console.time(`SourceService.getProjectSprints(${projectId})`);

    const result = await this.client.getAll<SourceSprint>(
      'msdyn_projectsprints',
      undefined,
      `_msdyn_project_value eq ${projectId}`
    );

    if (result.success && result.data) {
      console.log(`SourceService: Retrieved ${result.data.length} sprints for project ${projectId}`);
    }
    console.timeEnd(`SourceService.getProjectSprints(${projectId})`);
    return result;
  }

  /**
   * Fetch all data for a project (tasks, team, deps, assignments, buckets, sprints)
   */
  async getFullProjectData(project: SourceProject): Promise<ServiceResult<SourceProjectData>> {
    const projectId = project.msdyn_projectid;
    console.log(`SourceService: Starting getFullProjectData(${project.msdyn_subject})`);
    console.time(`SourceService.getFullProjectData(${projectId})`);

    // Fetch all entity types in parallel
    const [tasksResult, teamResult, depsResult, assignResult, bucketsResult, sprintsResult] = await Promise.all([
      this.getProjectTasks(projectId),
      this.getProjectTeamMembers(projectId),
      this.getProjectDependencies(projectId),
      this.getProjectAssignments(projectId),
      this.getProjectBuckets(projectId),
      this.getProjectSprints(projectId),
    ]);

    const data: SourceProjectData = {
      project,
      tasks: tasksResult.data || [],
      teamMembers: teamResult.data || [],
      dependencies: depsResult.data || [],
      assignments: assignResult.data || [],
      buckets: bucketsResult.data || [],
      sprints: sprintsResult.data || [],
    };

    console.log(`SourceService: Full data for "${project.msdyn_subject}": ${data.tasks.length} tasks, ${data.teamMembers.length} team, ${data.dependencies.length} deps, ${data.assignments.length} assignments, ${data.buckets.length} buckets, ${data.sprints.length} sprints`);
    console.timeEnd(`SourceService.getFullProjectData(${projectId})`);

    return { success: true, data, isLiveData: true };
  }

  /**
   * Get entity counts for a project (lightweight — only counts)
   */
  async getEntityCounts(projectId: string): Promise<ServiceResult<EntityCounts>> {
    console.log(`SourceService: Starting getEntityCounts(${projectId})`);

    const [tasks, team, deps, assignments, buckets, sprints] = await Promise.all([
      this.getProjectTasks(projectId),
      this.getProjectTeamMembers(projectId),
      this.getProjectDependencies(projectId),
      this.getProjectAssignments(projectId),
      this.getProjectBuckets(projectId),
      this.getProjectSprints(projectId),
    ]);

    return {
      success: true,
      data: {
        tasks: tasks.data?.length || 0,
        teamMembers: team.data?.length || 0,
        dependencies: deps.data?.length || 0,
        assignments: assignments.data?.length || 0,
        buckets: buckets.data?.length || 0,
        sprints: sprints.data?.length || 0,
      },
      isLiveData: true,
    };
  }
}
